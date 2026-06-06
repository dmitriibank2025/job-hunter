import { Prisma } from "@prisma/client";
import { prisma } from "../infrastructure/prisma";
import { isGmailConfigured, ParsedGmailMessage, searchGmailMessages } from "./gmail-api.service";
import { syncAppliedVacancyHistory } from "./applied-vacancy.service";

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
    '("your application" OR "thanks for applying" OR "application received" OR "we received your application" OR "application was viewed" OR "not moving forward" OR unfortunately OR rejected OR interview OR recruiter OR InMail OR "just messaged you" OR "action needed") -in:spam -in:trash';

function lookbackQuery(baseQuery: string): string {
    const newerThan = process.env.EMAIL_REPORT_NEWER_THAN ?? "7d";
    return `newer_than:${newerThan} ${baseQuery}`;
}

function reportLookbackDate(): Date {
    const hours = Number(process.env.EMAIL_REPORT_LOOKBACK_HOURS ?? 24);
    const safeHours = Number.isFinite(hours) && hours > 0 ? hours : 24;

    return new Date(Date.now() - safeHours * 60 * 60 * 1000);
}

function normalizeText(value: string): string {
    return value.toLowerCase();
}

function classifyEmail(message: ParsedGmailMessage): EmailEventType {
    const text = normalizeText([
        message.subject,
        message.from ?? "",
        message.snippet ?? "",
        message.bodyText ?? "",
    ].join("\n"));

    if (
        text.includes("not moving forward") ||
        text.includes("unfortunately") ||
        text.includes("other candidates") ||
        text.includes("not able to offer") ||
        text.includes("no longer open") ||
        text.includes("rejected")
    ) {
        return "REJECTION";
    }

    if (
        text.includes("selected") ||
        text.includes("congrats") ||
        text.includes("interview") ||
        text.includes("phone screen") ||
        text.includes("next steps")
    ) {
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
        text.includes("thanks for applying") ||
        text.includes("we received your application") ||
        text.includes("application was sent") ||
        text.includes("application received") ||
        text.includes("we got it")
    ) {
        return "APPLICATION_RECEIVED";
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

function sourceFromSender(sender?: string): string | undefined {
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

    return value.replace(/\s+/g, " ").trim().slice(0, 800);
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
        source: sourceFromSender(message.from),
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

async function syncEmailEvents(userId: string): Promise<{
    syncedCount: number;
    newEventsCount: number;
}> {
    const limit = Number(process.env.EMAIL_REPORT_SEARCH_LIMIT ?? 30);
    const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 30;
    const queries = [
        process.env.EMAIL_JOB_ALERT_QUERY ?? DEFAULT_JOB_ALERT_QUERY,
        process.env.EMAIL_APPLICATION_RESPONSE_QUERY ?? DEFAULT_APPLICATION_QUERY,
    ];
    const seen = new Set<string>();
    let syncedCount = 0;
    let newEventsCount = 0;

    for (const query of queries) {
        const messages = await searchGmailMessages(lookbackQuery(query), safeLimit);

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
    const limit = Number(process.env.EMAIL_REPORT_LIMIT ?? 15);
    const shownEvents = events.slice(0, Number.isFinite(limit) && limit > 0 ? limit : 15);
    const omittedCount = Math.max(events.length - shownEvents.length, 0);
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
    const eventText = shownEvents.length
        ? shownEvents.map((event, index) => formatEmailEvent(event, index + 1)).join("\n\n")
        : "No recent application responses or email job alerts.";
    const omittedText = omittedCount > 0 ? `\n\n...and ${omittedCount} more email events.` : "";

    return [
        "Email report:",
        counts,
        "",
        eventText + omittedText,
    ].join("\n");
}

export async function runEmailReport(userId: string): Promise<EmailReport> {
    const enabled = process.env.EMAIL_REPORT_ENABLED !== "false";
    const configured = isGmailConfigured();

    if (!enabled || !configured) {
        const reason = !enabled
            ? "Email report disabled."
            : "Email report skipped: Gmail OAuth env vars are missing.";

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

    const syncResult = await syncEmailEvents(userId);
    const appliedHistory = await syncAppliedVacancyHistory(userId);
    const events = await prisma.emailEvent.findMany({
        where: {
            userId,
            emailTs: {
                gte: reportLookbackDate(),
            },
            type: {
                not: "OTHER",
            },
        },
        orderBy: [
            { emailTs: "desc" },
        ],
        take: 100,
    });

    return {
        enabled,
        configured,
        syncedCount: syncResult.syncedCount,
        newEventsCount: syncResult.newEventsCount,
        appliedHistoryFromEmails: appliedHistory.fromEmails,
        appliedHistoryFromLocalApplications: appliedHistory.fromLocalApplications,
        events,
        message: buildEmailReportSection(events),
    };
}
