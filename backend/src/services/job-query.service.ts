import { prisma } from "../infrastructure/prisma";
import { analyzeJob } from "./job-analyzer.service";
import { ensureUserJobMatchesForUserArtifacts } from "./user-job-repair.service";
import type { ResumeBaseSelectionMap } from "./resume-base-selector.service";

// Конфигурация параллельной обработки
const ANALYSIS_CONCURRENCY = parseInt(process.env.ANALYSIS_CONCURRENCY || "5", 10);

async function processBatch<T, R>(
    items: T[],
    processor: (item: T, index: number) => Promise<R>,
    concurrency: number
): Promise<{ results: R[]; errors: { item: T; error: string }[] }> {
    const results: R[] = [];
    const errors: { item: T; error: string }[] = [];

    for (let i = 0; i < items.length; i += concurrency) {
        const batch = items.slice(i, i + concurrency);
        const batchPromises = batch.map((item, idx) =>
            processor(item, i + idx).then(
                result => ({ success: true as const, result, item }),
                error => ({ success: false as const, error: error.message, item })
            )
        );

        const batchResults = await Promise.all(batchPromises);

        for (const res of batchResults) {
            if (res.success) {
                results.push(res.result);
            } else {
                errors.push({ item: res.item, error: res.error });
            }
        }
    }

    return { results, errors };
}

export async function analyzeMissingUserJobs(userId: string, resumeBaseId?: string, resumeBaseIds?: ResumeBaseSelectionMap) {
    await ensureUserJobMatchesForUserArtifacts(userId);

    const matches = await prisma.userJobMatch.findMany({
        where: {
            userId,
            OR: [
                { matchScore: null },
                { status: "NEW" },
            ],
        },
        include: { job: true },
    });

    console.log(`[AnalyzeMissing] Found ${matches.length} jobs to analyze (concurrency: ${ANALYSIS_CONCURRENCY})`);

    const processor = async (match: typeof matches[0], index: number) => {
        console.log(`  ├─ Analyzing ${index + 1}/${matches.length}: ${match.job.title}`);
        return await analyzeJob(match.job.id, { userId, resumeBaseId, resumeBaseIds });
    };

    const { results, errors } = await processBatch(matches, processor, ANALYSIS_CONCURRENCY);

    if (errors.length > 0) {
        console.error(`[AnalyzeMissing] Failed to analyze ${errors.length} jobs:`);
        errors.forEach(e => console.error(`  ├─ ${(e.item as any).job.title}: ${e.error}`));
    }

    console.log(`[AnalyzeMissing] Complete: ${results.length} analyzed, ${errors.length} failed`);

    return {
        analyzed: results.length,
        failed: errors.length,
        results,
    };
}

export async function listTopUserJobs(userId: string) {
    const matches = await prisma.userJobMatch.findMany({
        where: {
            userId,
            matchScore: {
                not: null,
            },
        },
        orderBy: {
            matchScore: "desc",
        },
        take: 10,
        include: {
            job: true,
        },
    });

    return matches.map((match) => ({
        ...match.job,
        userMatch: match,
        matchScore: match.matchScore,
        analysis: match.analysis,
    }));
}

export async function getUserJobStatistics(userId: string) {
    const [
        generatedResumesResult,
        appliedMatchesResult,
        submittedApplicationsResult,
        positiveVacanciesResult,
        negativeVacanciesResult,
        trackedVacanciesResult,
        pendingFeedbackVacanciesResult,
        emailEventsResult,
        rejectionRecordsResult,
    ] = await Promise.allSettled([
        prisma.resumeVersion.count({ where: { userId } }),
        prisma.userJobMatch.count({ where: { userId, appliedAt: { not: null } } }),
        prisma.application.count({ where: { userId, OR: [{ submittedAt: { not: null } }, { status: "SUBMITTED" }] } }),
        prisma.appliedVacancy.count({ where: { userId, status: "POSITIVE_RESPONSE" } }),
        prisma.appliedVacancy.count({ where: { userId, status: "REJECTION" } }),
        prisma.appliedVacancy.count({ where: { userId } }),
        prisma.appliedVacancy.count({
            where: {
                userId,
                status: { in: ["ATTEMPTED", "APPLIED", "APPLICATION_RECEIVED", "APPLICATION_VIEWED"] },
            },
        }),
        prisma.emailEvent.count({ where: { userId } }),
        prisma.rejectionRecord.count({ where: { userId } }),
    ]);

    const generatedResumes = generatedResumesResult.status === "fulfilled" ? generatedResumesResult.value : 0;
    const appliedMatches = appliedMatchesResult.status === "fulfilled" ? appliedMatchesResult.value : 0;
    const submittedApplications = submittedApplicationsResult.status === "fulfilled" ? submittedApplicationsResult.value : 0;
    const positiveVacancies = positiveVacanciesResult.status === "fulfilled" ? positiveVacanciesResult.value : 0;
    const negativeVacancies = negativeVacanciesResult.status === "fulfilled" ? negativeVacanciesResult.value : 0;
    const trackedVacancies = trackedVacanciesResult.status === "fulfilled" ? trackedVacanciesResult.value : 0;
    const pendingFeedbackVacancies = pendingFeedbackVacanciesResult.status === "fulfilled" ? pendingFeedbackVacanciesResult.value : 0;
    const emailEvents = emailEventsResult.status === "fulfilled" ? emailEventsResult.value : 0;
    const rejectionRecords = rejectionRecordsResult.status === "fulfilled" ? rejectionRecordsResult.value : 0;

    // sent = max of manual applied marks or tracked applications
    const sent = Math.max(appliedMatches, submittedApplications);
    // tracked covers email-synced vacancies (includes positive + negative + pending)
    const tracked = trackedVacancies;
    // noResponse = tracked vacancies that are still in "sent/received/viewed" state
    // (not yet positive or negative). Use tracked as denominator, not sent,
    // because email-tracked and manually-marked are now unified via appliedAt sync.
    const noResponse = Math.max(0, tracked - positiveVacancies - negativeVacancies - pendingFeedbackVacancies);

    return {
        success: true,
        generatedResumes,
        sent,
        applied: appliedMatches,
        submitted: submittedApplications,
        tracked,
        positive: positiveVacancies,
        negative: negativeVacancies,
        noResponse,
        pendingFeedback: pendingFeedbackVacancies,
        emailEvents,
        rejectionRecords,
    };
}

export async function listUserJobs(userId: string) {
    await ensureUserJobMatchesForUserArtifacts(userId);

    const jobs = await prisma.job.findMany({
        where: {
            OR: [
                { userMatches: { some: { userId } } },
                { resumeVersions: { some: { userId } } },
                { coverLetters: { some: { userId } } },
                { applications: { some: { userId } } },
            ],
        },
        include: {
            resumeVersions: {
                where: { userId },
                orderBy: { createdAt: "desc" },
                select: {
                    id: true,
                    jobId: true,
                    format: true,
                    filePath: true,
                    pdfFilePath: true,
                    atsScore: true,
                    atsIssues: true,
                    atsMatchedKeywords: true,
                    atsMissingKeywords: true,
                    atsValidatedAt: true,
                    createdAt: true,
                },
            },
            coverLetters: {
                where: { userId },
                orderBy: { createdAt: "desc" },
                select: {
                    id: true,
                    jobId: true,
                    filePath: true,
                    createdAt: true,
                },
            },
            userMatches: {
                where: { userId },
                take: 1,
            },
        },
        orderBy: { createdAt: "desc" },
    });

    return jobs.map((job) => {
        const userMatch = "userMatches" in job ? job.userMatches?.[0] : undefined;
        const { userMatches: _userMatches, ...rest } = job;
        return {
            ...rest,
            userMatch,
        };
    });
}
