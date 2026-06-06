import { Job, Prisma } from "@prisma/client";
import { prisma } from "../infrastructure/prisma";
import { ParsedJob } from "../providers/types";

type JobInput = Pick<
    ParsedJob,
    "title" | "company" | "location" | "url" | "postedAt" | "description"
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
        parsed.search = "";
        parsed.hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();
        parsed.pathname = parsed.pathname.replace(/\/+$/, "");

        return parsed.toString().replace(/\/$/, "");
    } catch {
        return url.trim().toLowerCase().replace(/\/+$/, "") || null;
    }
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
        title: job.title,
        company: job.company,
        location: job.location,
        url: job.url,
        normalizedUrl: normalizeJobUrl(job.url),
        fingerprint: buildJobFingerprint(job),
        postedAt: job.postedAt,
        source: job.source,
        description: job.description,
    };
}

export async function findDuplicateJob(job: JobInput): Promise<Job | null> {
    const normalizedUrl = normalizeJobUrl(job.url);
    const fingerprint = buildJobFingerprint(job);

    return prisma.job.findFirst({
        where: {
            OR: [
                ...(normalizedUrl ? [{ normalizedUrl }, { url: job.url }] : []),
                ...(fingerprint ? [{ fingerprint }] : []),
            ],
        },
    });
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

        if (incomingDescription.length > existingDescription.length) {
            const updated = await prisma.job.update({
                where: { id: duplicate.id },
                data: buildJobCreateData({
                    ...job,
                    title: duplicate.title,
                    company: duplicate.company ?? job.company,
                    location: job.location ?? duplicate.location ?? undefined,
                    url: duplicate.url ?? job.url,
                    postedAt: duplicate.postedAt ?? job.postedAt,
                    source: duplicate.source ?? job.source,
                }),
            });

            return {
                job: updated,
                isNew: false,
                shouldProcess: existingResumeCount === 0,
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
