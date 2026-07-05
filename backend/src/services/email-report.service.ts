import { Prisma } from "@prisma/client";
import { prisma } from "../infrastructure/prisma";
import { isGmailConfigured, ParsedGmailMessage, searchGmailMessagesForUser } from "./gmail-api.service";
import { syncAppliedVacancyHistory } from "./applied-vacancy.service";
import { updateAutomationProgress } from "./job-automation-progress.service";

const EMAIL_EVENT_TYPES = [
    "NEW_JOB_ALERT",
    "APPLICATION_RECEIVED",
    "APPLICATION_VIEWED",
    "RECRUITER_MESSAGE",
    "ACTION_REQUIRED",
    "REJECTION",
    "POSITIVE_RESPONSE",
    "OTHER",
] as const;

type EmailEventType = typeof EMAIL_EVENT_TYPES[number];
type EmailEvent = Awaited<ReturnType<typeof prisma.emailEvent.findMany>>[number];

type EmailReport = {
    enabled: boolean;
    configured: boolean;
    syncedCount: number;
    newEventsCount: number;
    appliedHistoryFromEmails: number;
    appliedHistoryFromLocalApplications: number;
    events: EmailEvent[];
    message: string;
};

const DEFAULT_JOB_ALERT_QUERY =
    '(from:noreply@glassdoor.com OR from:jobs-noreply@linkedin.com OR from:jobsearch@linkedin.com OR subject:jobs OR subject:hiring OR subject:"job alert") -in:spam -in:trash';

const DEFAULT_APPLICATION_QUERY =
    '("your application" OR "thanks for applying" OR "thank you for applying" OR "thank you for your application" OR "application received" OR "we received your application" OR "application was viewed" OR "not moving forward" OR unfortunately OR rejected OR interview OR recruiter OR InMail OR "just messaged you" OR "action needed") -in:spam -in:trash';

function normalizeText(value: string): string {
    return value.toLowerCase();
}

function isApplicationAcknowledgement(text: string): boolean {
    return (
        text.includes("thanks for applying") ||
        text.includes("thank you for applying") ||
        text.includes("thank you for your application") ||
        text.includes("thanks for your application") ||
        text.includes("we received your application") ||
        text.includes("we have received your application") ||
        text.includes("application was sent") ||
        text.includes("application has been received") ||
        text.includes("application received") ||
        text.includes("we got it")
    );
}

function isSentApplication(message: ParsedGmailMessage, text: string): boolean {
    const labels = new Set(message.labels.map((label) => label.toUpperCase()));

    return labels.has("SENT") && (
        /\b(application|applied|candidacy)\b/.test(text) ||
        /\b(resume|cv|cover letter)\b/.test(text)
    );
}

function isRejection(text: string): boolean {
    // Explicit negative signals
    if (
        text.includes("not moving forward") ||
        text.includes("not a fit") ||
        text.includes("not the right fit") ||
        text.includes("not a match") ||
        text.includes("not proceeding") ||
        text.includes("decided not to") ||
        text.includes("not able to offer") ||
        text.includes("no longer open") ||
        text.includes("position has been filled") ||
        text.includes("position is no longer available") ||
        text.includes("we have filled") ||
        text.includes("role has been filled") ||
        text.includes("keep your resume on file") ||
        text.includes("keep your cv on file") ||
        text.includes("keep you in mind for future") ||
        text.includes("not selected") ||
        text.includes("not been selected") ||
        text.includes("not shortlisted") ||
        text.includes("rejected") ||
        text.includes("unsuccessful") ||
        text.includes("regret to inform") ||
        text.includes("we regret") ||
        text.includes("unfortunately")
    ) return true;

    // "other candidates" only counts as rejection when paired with advancement language
    if (
        /\bother candidates?\b.{0,120}\b(move forward|moving forward|proceed|progress|advance)\b/.test(text) ||
        /\b(move forward|moving forward|proceed)\b.{0,120}\bother candidates?\b/.test(text) ||
        text.includes("decided to move forward with other") ||
        text.includes("pursuing other candidates") ||
        text.includes("chose to move forward with other")
    ) return true;

    // "after careful consideration" almost always precedes a rejection
    if (
        /after careful consideration.{0,200}(not|unable|decided|regret)/i.test(text) ||
        /thank you for your (?:time|interest|application).{0,200}(not|unable|unfortunately|regret)/i.test(text)
    ) return true;

    return false;
}

function isPositiveResponse(text: string): boolean {
    if (
        text.includes("phone screen") ||
        text.includes("shortlisted") ||
        /\bcongrats\b|\bcongratulations\b/.test(text) ||
        /\bselected\s+for\s+(?:an?\s+|the\s+)?interview\b/.test(text) ||
        /\binvit(?:e|ed|ation)\b.{0,80}\b(interview|call|conversation|meeting)\b/.test(text) ||
        /\bschedule\b.{0,80}\b(interview|call|conversation|meeting)\b/.test(text) ||
        /\bwould like to\b.{0,80}\b(speak|talk|meet|interview)\b/.test(text) ||
        /\bnext steps?\b.{0,80}\b(interview|call|conversation|meeting|process)\b/.test(text)
    ) return true;

    // "interview" is strong signal but guard against "we are not proceeding to interview"
    if (/\binterview\b/.test(text) && !isRejection(text)) return true;

    // "move forward" without rejection context
    if (/\b(move forward|moving forward)\b/.test(text) && !isRejection(text)) return true;

    return false;
}

function classifyEmail(message: ParsedGmailMessage): EmailEventType {
    const text = normalizeText([
        message.subject,
        message.from ?? "",
        message.snippet ?? "",
        message.bodyText ?? "",
    ].join("\n"));

    if (isSentApplication(message, text)) {
        return "APPLICATION_RECEIVED";
    }

    // Rejection must be checked before positive — many rejections use polite positive-sounding phrases
    if (isRejection(text)) {
        return "REJECTION";
    }

    if (isApplicationAcknowledgement(text)) {
        return "APPLICATION_RECEIVED";
    }

    if (isPositiveResponse(text)) {
        return "POSITIVE_RESPONSE";
    }

    if (
        text.includes("action needed") ||
        text.includes("manage my consent") ||
        text.includes("confirm your consent")
    ) {
        return "ACTION_REQUIRED";
    }

    if (
        text.includes("just messaged you") ||
        text.includes("inmail") ||
        text.includes("recruiter") ||
        text.includes("head hunter")
    ) {
        return "RECRUITER_MESSAGE";
    }

    if (
        text.includes("application was viewed") ||
        text.includes("viewed your application")
    ) {
        return "APPLICATION_VIEWED";
    }

    if (
        text.includes("job alert") ||
        text.includes("apply now") ||
        text.includes("new jobs") ||
        text.includes("is hiring")
    ) {
        return "NEW_JOB_ALERT";
    }

    return "OTHER";
}

function sourceFromMessage(message: ParsedGmailMessage): string | undefined {
    if (message.labels.some((label) => label.toUpperCase() === "SENT")) return "SENT_EMAIL";

    const sender = message.from;
    if (!sender) return undefined;

    const value = sender.toLowerCase();

    if (value.includes("linkedin")) return "LINKEDIN_EMAIL";
    if (value.includes("glassdoor")) return "GLASSDOOR_EMAIL";
    if (value.includes("greenhouse")) return "GREENHOUSE_EMAIL";
    if (value.includes("comeet")) return "COMEET_EMAIL";
    if (value.includes("bamboohr")) return "BAMBOOHR_EMAIL";

    return undefined;
}

const BLOCKED_URL_PATTERNS =
    /(?:privacy|unsubscribe|help\.linkedin|linkedin\.com\/help|support|terms|preferences|manage-email|email-settings)/i;

export function extractUrls(value?: string | null): string[] {
    if (!value) return [];

    const matches = value.match(/https?:\/\/[^\s)\]]+/g) ?? [];
    const seen = new Set<string>();

    return matches.filter((url) => {
        if (BLOCKED_URL_PATTERNS.test(url)) return false;
        if (seen.has(url)) return false;

        seen.add(url);
        return true;
    });
}

function firstUrl(value?: string): string | undefined {
    return extractUrls(value)[0];
}

function preview(value?: string): string | undefined {
    if (!value) return undefined;

    return value.replace(/\s+/g, " ").trim();
}

async function saveEmailEvent(userId: string, message: ParsedGmailMessage): Promise<{
    event: EmailEvent;
    created: boolean;
}> {
    const existing = await prisma.emailEvent.findUnique({
        where: {
            userId_gmailMessageId: { userId, gmailMessageId: message.id },
        },
    });

    const data = {
        gmailThreadId: message.threadId,
        type: classifyEmail(message),
        source: sourceFromMessage(message),
        subject: message.subject,
        from: message.from,
        snippet: message.snippet,
        bodyPreview: preview(message.bodyText),
        url: firstUrl(message.bodyText) ?? firstUrl(message.snippet) ?? null,
        emailTs: message.emailTs,
        labels: message.labels,
        raw: {
            ...(message.raw as Record<string, unknown>),
            parsedBodyText: message.bodyText,
            parsedSnippet: message.snippet,
            parsedUrls: extractUrls([message.bodyText, message.snippet].filter(Boolean).join("\n")),
        } as Prisma.InputJsonValue,
    };

    const event = await prisma.emailEvent.upsert({
        where: {
            userId_gmailMessageId: { userId, gmailMessageId: message.id },
        },
        create: {
            userId,
            gmailMessageId: message.id,
            ...data,
        },
        update: data,
    });

    return {
        event,
        created: !existing,
    };
}

function gmailAfterFilter(days?: number): string {
    if (!days || !Number.isFinite(days) || days <= 0) return "";
    const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(date.getUTCDate()).padStart(2, "0");
    return ` after:${yyyy}/${mm}/${dd}`;
}

async function syncEmailEvents(userId: string, gmailScanDays?: number): Promise<{
    syncedCount: number;
    newEventsCount: number;
}> {
    const afterFilter = gmailAfterFilter(gmailScanDays);
    const queries = [
        (process.env.EMAIL_JOB_ALERT_QUERY ?? DEFAULT_JOB_ALERT_QUERY) + afterFilter,
        (process.env.EMAIL_APPLICATION_RESPONSE_QUERY ?? DEFAULT_APPLICATION_QUERY) + afterFilter,
        '(in:sent (resume OR cv OR "cover letter" OR application OR applied OR "my candidacy")) -in:spam -in:trash' + afterFilter,
    ];
    const existingEvents = await prisma.emailEvent.findMany({
        where: { userId },
        select: { gmailMessageId: true },
    });
    const seen = new Set(existingEvents.map((event) => event.gmailMessageId));
    let syncedCount = 0;
    let newEventsCount = 0;

    for (let queryIndex = 0; queryIndex < queries.length; queryIndex += 1) {
        const query = queries[queryIndex];
        const label = queryIndex === 0
            ? "job alerts"
            : queryIndex === 1
                ? "application responses"
                : "sent applications";

        updateAutomationProgress(userId, {
            stage: "Email report",
            message: `Scanning Gmail ${label} (${queryIndex + 1}/${queries.length})...`,
            percent: 5 + queryIndex * 3,
            currentStep: 1,
        });

        const messages = await searchGmailMessagesForUser(userId, query, undefined, (progress) => {
            updateAutomationProgress(userId, {
                stage: "Email report",
                message: progress.done
                    ? `Finished Gmail ${label}: ${progress.fetchedMessages} new, ${progress.skippedMessages} already synced.`
                    : `Scanning Gmail ${label}: page ${progress.page}, ${progress.fetchedMessages} new, ${progress.skippedMessages} already synced...`,
                percent: Math.min(14, 5 + queryIndex * 3 + Math.min(progress.page, 3)),
                currentStep: 1,
            });
        }, seen);

        for (const message of messages) {
            if (seen.has(message.id)) continue;
            seen.add(message.id);

            const result = await saveEmailEvent(userId, message);
            syncedCount += 1;
            if (result.created) newEventsCount += 1;
        }
    }

    return {
        syncedCount,
        newEventsCount,
    };
}

function labelForType(type: EmailEventType): string {
    switch (type) {
        case "ACTION_REQUIRED":
            return "Action needed";
        case "POSITIVE_RESPONSE":
            return "Positive / next step";
        case "RECRUITER_MESSAGE":
            return "Recruiter message";
        case "APPLICATION_VIEWED":
            return "Application viewed";
        case "APPLICATION_RECEIVED":
            return "Application received";
        case "REJECTION":
            return "Rejection / closed";
        case "NEW_JOB_ALERT":
            return "New job alert";
        default:
            return "Other";
    }
}

function formatDate(date: Date): string {
    return new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: process.env.JOB_REPORT_TIMEZONE ?? "Asia/Jerusalem",
    }).format(date);
}

function formatEmailEvent(event: EmailEvent, index: number): string {
    const source = event.source ? ` | ${event.source}` : "";
    const from = event.from ? `\nFrom: ${event.from}` : "";
    const snippet = event.snippet ? `\n${event.snippet}` : "";
    const url = event.url ? `\n${event.url}` : "";

    return `${index}. [${labelForType(event.type)}] ${event.subject}${source}\n${formatDate(event.emailTs)}${from}${snippet}${url}`;
}

export function buildEmailReportSection(events: EmailEvent[]): string {
    const grouped = new Map<EmailEventType, number>();

    for (const event of events) {
        grouped.set(event.type, (grouped.get(event.type) ?? 0) + 1);
    }

    const counts = grouped.size
        ? Array.from(grouped.entries())
            .sort(([a], [b]) => labelForType(a).localeCompare(labelForType(b)))
            .map(([type, count]) => `- ${labelForType(type)}: ${count}`)
            .join("\n")
        : "No email events found.";
    const eventText = events.length
        ? events.map((event, index) => formatEmailEvent(event, index + 1)).join("\n\n")
        : "No recent application responses or email job alerts.";

    return [
        "Email report:",
        counts,
        "",
        eventText,
    ].join("\n");
}

export async function runEmailReport(userId: string, gmailScanDays?: number): Promise<EmailReport> {
    const enabled = process.env.EMAIL_REPORT_ENABLED !== "false";
    const configured = await isGmailConfigured(userId);

    if (!enabled || !configured) {
        const reason = !enabled
            ? "Email report disabled."
            : "Email report skipped: Gmail OAuth is not connected.";

        return {
            enabled,
            configured,
            syncedCount: 0,
            newEventsCount: 0,
            appliedHistoryFromEmails: 0,
            appliedHistoryFromLocalApplications: 0,
            events: [],
            message: reason,
        };
    }

    let syncResult = { syncedCount: 0, newEventsCount: 0 };
    let syncErrorMessage: string | undefined;

    try {
        syncResult = await syncEmailEvents(userId, gmailScanDays);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        syncErrorMessage = /invalid_grant|expired|revoked/i.test(message)
            ? "Gmail sync skipped: refresh token expired or was revoked. Reconnect Gmail OAuth to resume live sync."
            : `Gmail sync skipped: ${message}`;
    }

    const appliedHistory = await syncAppliedVacancyHistory(userId);
    const lookbackDate = gmailScanDays ? new Date(Date.now() - gmailScanDays * 24 * 60 * 60 * 1000) : undefined;
    const events = await prisma.emailEvent.findMany({
        where: {
            userId,
            ...(lookbackDate ? { emailTs: { gte: lookbackDate } } : {}),
        },
        orderBy: [
            { emailTs: "desc" },
        ],
    });

    return {
        enabled,
        configured,
        syncedCount: syncResult.syncedCount,
        newEventsCount: syncResult.newEventsCount,
        appliedHistoryFromEmails: appliedHistory.fromEmails,
        appliedHistoryFromLocalApplications: appliedHistory.fromLocalApplications,
        events,
        message: syncErrorMessage
            ? `${syncErrorMessage}\n\n${buildEmailReportSection(events)}`
            : buildEmailReportSection(events),
    };
}
