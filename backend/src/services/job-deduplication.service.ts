import { Job, Prisma } from "@prisma/client";
import { prisma } from "../infrastructure/prisma";
import { ParsedJob } from "../providers/types";

type JobInput = Pick<
    ParsedJob,
    "title" | "externalJobId" | "company" | "location" | "url" | "postedAt" | "description" |
    "applyUrl" | "employmentType" | "ingestion"
> & {
    source?: string;
};

function normalizeText(value?: string | null): string {
    return (value ?? "")
        .toLowerCase()
        .trim()
        .replace(/\s+/g, " ");
}

export function normalizeJobUrl(url?: string | null): string | null {
    if (!url) return null;

    try {
        const parsed = new URL(url);
        parsed.hash = "";
        const identityParameter = ["JobID", "jobId", "key", "gh_jid", "currentJobId"]
            .map((key) => [key, parsed.searchParams.get(key)] as const)
            .find(([, value]) => Boolean(value));
        parsed.search = identityParameter ? `?${identityParameter[0]}=${encodeURIComponent(identityParameter[1]!)}` : "";
        parsed.hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();
        parsed.pathname = parsed.pathname.replace(/\/+$/, "");

        return parsed.toString().replace(/\/$/, "");
    } catch {
        return url.trim().toLowerCase().replace(/\/+$/, "") || null;
    }
}

function cleanExternalJobId(value?: string | null): string | null {
    const cleaned = value?.trim();
    return cleaned || null;
}

export function inferExternalJobId(url?: string | null, source?: string | null): string | null {
    if (!url) return null;

    try {
        const parsed = new URL(url);
        const params = [
            "currentJobId",
            "jobId",
            "jobsId",
            "gh_jid",
            "gh_src",
            "jl",
            "jk",
            "reqId",
            "requisitionId",
            "requisition",
        ];

        for (const param of params) {
            const value = cleanExternalJobId(parsed.searchParams.get(param));
            if (value) return value;
        }

        const path = parsed.pathname;
        const linkedInMatch = /\/jobs\/view\/(?:[^/]*-)?(\d{6,})\/?$/i.exec(path)
            ?? /-(\d{6,})\/?$/i.exec(path);
        if ((source === "LINKEDIN" || /linkedin\./i.test(parsed.hostname)) && linkedInMatch?.[1]) {
            return linkedInMatch[1];
        }

        const greenhouseMatch = /\/jobs\/(\d{4,})\/?$/i.exec(path);
        if ((source === "GREENHOUSE" || /greenhouse\.io/i.test(parsed.hostname)) && greenhouseMatch?.[1]) {
            return greenhouseMatch[1];
        }

        const uuidMatch = /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(path);
        if (uuidMatch?.[1]) return uuidMatch[1];

        const numericPathMatch = /(?:job|jobs|position|opening|requisition|req)[^0-9]{0,12}(\d{5,})/i.exec(path)
            ?? /\/(\d{7,})\/?$/i.exec(path);
        return numericPathMatch?.[1] ?? null;
    } catch {
        const linkedInMatch = /linkedin\.[^\s/]+\/jobs\/view\/(?:[^/\s]*-)?(\d{6,})/i.exec(url)
            ?? /currentJobId=(\d{6,})/i.exec(url);
        return linkedInMatch?.[1] ?? null;
    }
}

function resolveExternalJobId(job: JobInput): string | null {
    return cleanExternalJobId(job.externalJobId) ?? inferExternalJobId(job.url, job.source);
}

function normalizePostedAt(value?: Date | string | null): string {
    if (!value) return "";

    const date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) return "";

    return date.toISOString();
}

export function buildJobFingerprint(job: Pick<JobInput, "title" | "company" | "postedAt">): string | null {
    const postedAt = normalizePostedAt(job.postedAt);

    if (!postedAt) return null;

    return [
        normalizeText(job.title),
        normalizeText(job.company),
        postedAt,
    ].join("|");
}

export function buildJobCreateData(job: JobInput) {
    return {
        externalJobId: resolveExternalJobId(job),
        title: job.title,
        company: job.company,
        location: job.location,
        url: job.url,
        normalizedUrl: normalizeJobUrl(job.url),
        fingerprint: buildJobFingerprint(job),
        postedAt: job.postedAt,
        applyUrl: job.applyUrl,
        employmentType: job.employmentType,
        source: job.source,
        description: job.description,
        ingestionQualityScore: job.ingestion?.qualityScore,
        ingestionQualityState: job.ingestion?.qualityState,
        ingestionMetadata: job.ingestion as Prisma.InputJsonValue | undefined,
    };
}

export async function findDuplicateJob(job: JobInput): Promise<Job | null> {
    const normalizedUrl = normalizeJobUrl(job.url);
    const fingerprint = buildJobFingerprint(job);
    const externalJobId = resolveExternalJobId(job);

    return prisma.job.findFirst({
        where: {
            OR: [
                ...(externalJobId && job.source ? [{ source: job.source, externalJobId }] : []),
                ...(normalizedUrl ? [{ normalizedUrl }, { url: job.url }] : []),
                ...(fingerprint ? [{ fingerprint }] : []),
            ],
        },
    });
}

// Batch deduplication для ускорения массовой обработки
export async function findDuplicateJobsBatch(jobs: JobInput[]): Promise<Map<string, Job>> {
    if (jobs.length === 0) return new Map();

    const normalizedUrls = jobs
        .map(j => normalizeJobUrl(j.url))
        .filter((url): url is string => url !== null);

    const fingerprints = jobs
        .map(j => buildJobFingerprint(j))
        .filter((fp): fp is string => fp !== null);
    const sourceExternalIds = jobs
        .map(j => ({ source: j.source, externalJobId: resolveExternalJobId(j) }))
        .filter((item): item is { source: string; externalJobId: string } => Boolean(item.source && item.externalJobId));

    const duplicates = await prisma.job.findMany({
        where: {
            OR: [
                ...sourceExternalIds.map(({ source, externalJobId }) => ({ source, externalJobId })),
                ...(normalizedUrls.length > 0 ? [{ normalizedUrl: { in: normalizedUrls } }] : []),
                ...(normalizedUrls.length > 0 ? [{ url: { in: normalizedUrls } }] : []),
                ...(fingerprints.length > 0 ? [{ fingerprint: { in: fingerprints } }] : []),
            ],
        },
    });

    const result = new Map<string, Job>();

    for (const job of jobs) {
        const normalizedUrl = normalizeJobUrl(job.url);
        const fingerprint = buildJobFingerprint(job);
        const externalJobId = resolveExternalJobId(job);

        const duplicate = duplicates.find(d =>
            (externalJobId && job.source && d.source === job.source && d.externalJobId === externalJobId) ||
            (normalizedUrl && (d.normalizedUrl === normalizedUrl || d.url === job.url)) ||
            (fingerprint && d.fingerprint === fingerprint)
        );

        if (duplicate) {
            result.set(job.url || externalJobId || fingerprint || "", duplicate);
        }
    }

    return result;
}

export async function createJobIfNew(job: JobInput): Promise<{
    job: Job;
    isNew: boolean;
    shouldProcess: boolean;
}> {
    const duplicate = await findDuplicateJob(job);

    if (duplicate) {
        const incomingDescription = job.description?.trim() ?? "";
        const existingDescription = duplicate.description?.trim() ?? "";
        const existingResumeCount = await prisma.resumeVersion.count({
            where: { jobId: duplicate.id },
        });
        const longerDescription = incomingDescription.length > existingDescription.length;
        const incomingQualityScore = job.ingestion?.qualityScore;
        const improvesQuality = incomingQualityScore !== undefined &&
            (duplicate.ingestionQualityScore === null || incomingQualityScore > duplicate.ingestionQualityScore);
        const updates: Prisma.JobUpdateInput = {};

        if (longerDescription) updates.description = job.description;
        if (!duplicate.company?.trim() && job.company?.trim()) updates.company = job.company;
        if (!duplicate.location?.trim() && job.location?.trim()) updates.location = job.location;
        if (!duplicate.postedAt && job.postedAt) updates.postedAt = job.postedAt;
        if (!duplicate.applyUrl && job.applyUrl) updates.applyUrl = job.applyUrl;
        if (!duplicate.employmentType && job.employmentType) updates.employmentType = job.employmentType;
        if (!duplicate.externalJobId) {
            const externalJobId = resolveExternalJobId(job);
            if (externalJobId) updates.externalJobId = externalJobId;
        }
        if (!duplicate.normalizedUrl) {
            const normalizedUrl = normalizeJobUrl(duplicate.url ?? job.url);
            if (normalizedUrl) updates.normalizedUrl = normalizedUrl;
        }
        if (!duplicate.fingerprint) {
            const fingerprint = buildJobFingerprint({
                title: duplicate.title,
                company: duplicate.company ?? job.company,
                postedAt: duplicate.postedAt ?? job.postedAt,
            });
            if (fingerprint) updates.fingerprint = fingerprint;
        }
        if (improvesQuality) {
            updates.ingestionQualityScore = incomingQualityScore;
            updates.ingestionQualityState = job.ingestion?.qualityState;
            updates.ingestionMetadata = job.ingestion as Prisma.InputJsonValue;
        } else if (!duplicate.ingestionMetadata && job.ingestion) {
            updates.ingestionMetadata = job.ingestion as Prisma.InputJsonValue;
            if (!duplicate.ingestionQualityState) updates.ingestionQualityState = job.ingestion.qualityState;
        }

        if (Object.keys(updates).length) {
            const updated = await prisma.job.update({
                where: { id: duplicate.id },
                data: updates,
            });

            return {
                job: updated,
                isNew: false,
                shouldProcess: existingResumeCount === 0 && (longerDescription || updated.description.trim().length >= 500),
            };
        }

        return {
            job: duplicate,
            isNew: false,
            shouldProcess: existingResumeCount === 0 && existingDescription.length >= 500,
        };
    }

    try {
        const created = await prisma.job.create({
            data: buildJobCreateData(job),
        });

        return {
            job: created,
            isNew: true,
            shouldProcess: true,
        };
    } catch (error) {
        if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
        ) {
            const duplicateAfterRace = await findDuplicateJob(job);

            if (duplicateAfterRace) {
                return {
                    job: duplicateAfterRace,
                    isNew: false,
                    shouldProcess: false,
                };
            }
        }

        throw error;
    }
}

// Batch создание для ускорения массового импорта
export async function createJobsBatch(jobs: JobInput[]): Promise<{
    created: Job[];
    duplicates: Job[];
}> {
    const duplicateMap = await findDuplicateJobsBatch(jobs);

    const newJobs = jobs.filter(job => !duplicateMap.has(job.url || resolveExternalJobId(job) || buildJobFingerprint(job) || ""));

    const created: Job[] = [];
    const duplicates: Job[] = [];

    // Создаем новые вакансии батчами для ускорения
    for (let i = 0; i < newJobs.length; i += 50) {
        const batch = newJobs.slice(i, i + 50);
        const createdBatch = await prisma.$transaction(
            batch.map(job => prisma.job.create({ data: buildJobCreateData(job) }))
        );
        created.push(...createdBatch);
    }

    duplicates.push(...Array.from(duplicateMap.values()));

    return { created, duplicates };
}
