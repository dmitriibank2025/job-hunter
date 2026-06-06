import { EmailEventType, Prisma } from "@prisma/client";
import { prisma } from "../infrastructure/prisma";
import { ParsedJob } from "../providers/types";

type AppliedVacancyStatus =
    | "ATTEMPTED"
    | "APPLIED"
    | "APPLICATION_RECEIVED"
    | "APPLICATION_VIEWED"
    | "RECRUITER_MESSAGE"
    | "ACTION_REQUIRED"
    | "REJECTION"
    | "POSITIVE_RESPONSE";

type AppliedVacancyInput = {
    userId: string;
    title: string;
    company: string;
    status: AppliedVacancyStatus;
    source: string;
    jobUrl?: string | null;
    emailSubject?: string | null;
    emailFrom?: string | null;
    seenAt?: Date;
    raw?: Prisma.InputJsonValue;
};

function normalizeValue(value?: string | null): string {
    return (value ?? "")
        .toLowerCase()
        .replace(/&amp;/g, "&")
        .replace(/[^\p{L}\p{N}+#.]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function cleanCompany(value?: string | null): string {
    return (value ?? "")
        .replace(/^"|"$/g, "")
        .replace(/\s+via\s+linkedin.*$/i, "")
        .replace(/\s+no-reply.*$/i, "")
        .replace(/\s+notifications?.*$/i, "")
        .replace(/\s+jobs-noreply.*$/i, "")
        .replace(/\s+noreply.*$/i, "")
        .replace(/\s+<[^>]+>.*$/i, "")
        .replace(/\s+/g, " ")
        .trim();
}

function cleanTitle(value?: string | null): string {
    return (value ?? "")
        .replace(/\s+\.\s+we .+$/i, "")
        .replace(/\s+\.?\s+we have reviewed.+$/i, "")
        .replace(/\s+job was submitted successfully$/i, "")
        .replace(/^applying to the\s+/i, "")
        .replace(/^applying for the\s+/i, "")
        .replace(/\s+position$/i, "")
        .replace(/\s+position at .+$/i, "")
        .replace(/\s+opportunity$/i, "")
        .replace(/\s+/g, " ")
        .trim();
}

function isUsefulTitle(value?: string | null): value is string {
    const title = cleanTitle(value);

    if (!title || title.length < 4 || title.length > 120) return false;

    return !/^(a|the|a position|position|opportunity|applying for a)$/i.test(title);
}

export function buildAppliedVacancyFingerprint(title?: string | null, company?: string | null): string | null {
    const normalizedTitle = normalizeValue(title);
    const normalizedCompany = normalizeValue(company);

    if (!normalizedTitle || !normalizedCompany) return null;

    return `${normalizedCompany}|${normalizedTitle}`;
}

function statusFromEmailType(type: EmailEventType): AppliedVacancyStatus | null {
    switch (type) {
        case "APPLICATION_RECEIVED":
            return "APPLICATION_RECEIVED";
        case "APPLICATION_VIEWED":
            return "APPLICATION_VIEWED";
        case "ACTION_REQUIRED":
            return "ACTION_REQUIRED";
        case "RECRUITER_MESSAGE":
            return "RECRUITER_MESSAGE";
        case "REJECTION":
            return "REJECTION";
        case "POSITIVE_RESPONSE":
            return "POSITIVE_RESPONSE";
        default:
            return null;
    }
}

function companyFromSubject(subject: string): string | undefined {
    const patterns = [
        /your application to .+? at ([^|]+)$/i,
        /application (?:was )?sent to ([^|]+)$/i,
        /your application (?:at|to) ([^|]+)$/i,
        /update from ([^|]+)$/i,
        /thanks for applying to ([^|]+)$/i,
        /thank you for applying to ([^|]+)$/i,
    ];

    for (const pattern of patterns) {
        const value = pattern.exec(subject)?.[1];
        if (value) return cleanCompany(value);
    }

    return undefined;
}

function companyTitleFromBody(body?: string | null): { company?: string; title?: string } {
    if (!body) return {};

    const patterns = [
        /applying to (?:the )?(.+?) position at ([^.]+)\./i,
        /applying for (?:the )?(.+?) position at ([^.]+)\./i,
        /submitted your application for (?:the )?(.+?) position/i,
        /applying for a position at ([^.]+)\./i,
        /applying for (?:the )?(.+?) position/i,
    ];

    for (const pattern of patterns) {
        const match = pattern.exec(body);
        if (!match) continue;

        if (match.length >= 3) {
            return {
                title: cleanTitle(match[1]),
                company: cleanCompany(match[2]),
            };
        }

        if (/position at/i.test(pattern.source)) {
            return {
                company: cleanCompany(match[1]),
            };
        }

        return {
            title: cleanTitle(match[1]),
        };
    }

    return {};
}

function companyFromSender(sender?: string | null): string | undefined {
    if (!sender) return undefined;

    const beforeEmail = sender.replace(/<[^>]+>/g, "").trim();
    const company = cleanCompany(beforeEmail);

    if (
        !company ||
        /linkedin|greenhouse|glassdoor|bamboohr|comeet|spark hire|notifications?|no-reply|noreply|jobs/i.test(company)
    ) {
        return undefined;
    }

    return company;
}

function titleFromText(subject: string, body?: string | null): string | undefined {
    const subjectPatterns = [
        /your application to (.+?) at .+$/i,
        /thanks for applying for (?:the )?(.+?)$/i,
        /acknowledgement of your application for (?:the )?(.+?)(?: position)?$/i,
    ];
    const bodyPatterns = [
        /applying for (?:the )?(.+?)(?: position| at |\.|$)/i,
        /application for (?:the )?(.+?)(?: position| at |\.|$)/i,
        /for (?:the )?(.+?)(?: position| Position)/i,
        /Position:\s*(.+?)(?:\n|$)/i,
        /opportunity at .+?\n(.+?)(?:\n|$)/i,
    ];

    for (const pattern of subjectPatterns) {
        const value = pattern.exec(subject)?.[1];
        const title = cleanTitle(value);
        if (isUsefulTitle(title)) return title;
    }

    const text = body ?? "";

    for (const pattern of bodyPatterns) {
        const value = pattern.exec(text)?.[1];
        const title = cleanTitle(value);
        if (isUsefulTitle(title)) return title;
    }

    return undefined;
}

function titleFromLinkedInBody(company?: string, body?: string | null): string | undefined {
    if (!company || !body) return undefined;

    const escapedCompany = company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`([A-Z][^\\n]{3,100})\\s+${escapedCompany}\\s+[·-]`, "i").exec(body);
        const title = cleanTitle(match?.[1]);

    return isUsefulTitle(title) ? title : undefined;
}

export async function upsertAppliedVacancy(input: AppliedVacancyInput) {
    const title = cleanTitle(input.title);
    const company = cleanCompany(input.company);
    const fingerprint = buildAppliedVacancyFingerprint(title, company);

    if (!fingerprint) return null;

    return prisma.appliedVacancy.upsert({
        where: { userId_fingerprint: { userId: input.userId, fingerprint } },
        create: {
            userId: input.userId,
            fingerprint,
            title,
            company,
            status: input.status,
            source: input.source,
            jobUrl: input.jobUrl,
            emailSubject: input.emailSubject,
            emailFrom: input.emailFrom,
            firstSeenAt: input.seenAt ?? new Date(),
            lastSeenAt: input.seenAt ?? new Date(),
            raw: input.raw,
        },
        update: {
            status: input.status,
            source: input.source,
            jobUrl: input.jobUrl,
            emailSubject: input.emailSubject,
            emailFrom: input.emailFrom,
            lastSeenAt: input.seenAt ?? new Date(),
            raw: input.raw,
        },
    });
}

export async function syncAppliedVacanciesFromEmails(userId: string) {
    const events = await prisma.emailEvent.findMany({
        where: {
            userId,
            type: {
                in: [
                    "APPLICATION_RECEIVED",
                    "APPLICATION_VIEWED",
                    "RECRUITER_MESSAGE",
                    "ACTION_REQUIRED",
                    "REJECTION",
                    "POSITIVE_RESPONSE",
                ],
            },
        },
        orderBy: {
            emailTs: "desc",
        },
        take: Number(process.env.EMAIL_APPLICATION_HISTORY_LIMIT ?? 500),
    });
    let createdOrUpdated = 0;

    for (const event of events) {
        const status = statusFromEmailType(event.type);
        if (!status) continue;

        const bodyInfo = companyTitleFromBody(event.bodyPreview);
        const company =
            bodyInfo.company ??
            companyFromSubject(event.subject) ??
            companyFromSender(event.from);
        const title =
            (isUsefulTitle(bodyInfo.title) ? bodyInfo.title : undefined) ??
            titleFromText(event.subject, event.bodyPreview) ??
            titleFromLinkedInBody(company, event.bodyPreview);

        if (!company || !title) continue;

        const result = await upsertAppliedVacancy({
            userId,
            title,
            company,
            status,
            source: "EMAIL",
            jobUrl: event.url,
            emailSubject: event.subject,
            emailFrom: event.from,
            seenAt: event.emailTs,
            raw: {
                emailEventId: event.id,
                emailEventType: event.type,
            },
        });

        if (result) createdOrUpdated += 1;
    }

    return createdOrUpdated;
}

export async function syncAppliedVacanciesFromLocalApplications(userId: string) {
    const applications = await prisma.application.findMany({
        where: { userId },
        include: {
            job: true,
        },
        orderBy: {
            createdAt: "desc",
        },
        take: Number(process.env.LOCAL_APPLICATION_HISTORY_LIMIT ?? 500),
    });
    let createdOrUpdated = 0;

    for (const application of applications) {
        if (!application.job.company || !application.job.title) continue;

        const result = await upsertAppliedVacancy({
            userId,
            title: application.job.title,
            company: application.job.company,
            status: application.status === "SUBMITTED" ? "APPLIED" : "ATTEMPTED",
            source: "LOCAL_APPLICATION",
            jobUrl: application.submitUrl ?? application.job.url,
            seenAt: application.submittedAt ?? application.createdAt,
            raw: {
                applicationId: application.id,
                jobId: application.jobId,
                status: application.status,
            },
        });

        if (result) createdOrUpdated += 1;
    }

    return createdOrUpdated;
}

export async function syncAppliedVacancyHistory(userId: string) {
    const [fromEmails, fromLocalApplications] = await Promise.all([
        syncAppliedVacanciesFromEmails(userId),
        syncAppliedVacanciesFromLocalApplications(userId),
    ]);

    return {
        fromEmails,
        fromLocalApplications,
    };
}

export async function hasAppliedVacancyForJob(userId: string, job: Pick<ParsedJob, "title"> & { company?: string | null }) {
    const fingerprint = buildAppliedVacancyFingerprint(job.title, job.company);

    if (!fingerprint) return false;

    const existing = await prisma.appliedVacancy.findUnique({
        where: {
            userId_fingerprint: { userId, fingerprint },
        },
    });

    return Boolean(existing);
}

export async function listAppliedVacancies(userId: string, limit = 100) {
    return prisma.appliedVacancy.findMany({
        where: { userId },
        orderBy: {
            lastSeenAt: "desc",
        },
        take: limit,
    });
}
