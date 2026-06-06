import { prisma } from "../infrastructure/prisma";
import { analyzeJob } from "./job-analyzer.service";
import { ensureUserJobMatchesForUserArtifacts } from "./user-job-repair.service";

export async function analyzeMissingUserJobs(userId: string, resumeBaseId?: string) {
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

    const results = [];

    for (const match of matches) {
        try {
            const result = await analyzeJob(match.job.id, { userId, resumeBaseId });
            results.push(result);
        } catch (error) {
            console.error(error);
        }
    }

    return {
        analyzed: results.length,
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
        sentMatchesResult,
        positiveVacanciesResult,
        negativeVacanciesResult,
        noResponseVacanciesResult,
        emailEventsResult,
    ] = await Promise.allSettled([
        prisma.resumeVersion.count({ where: { userId } }),
        prisma.userJobMatch.count({ where: { userId, appliedAt: { not: null } } }),
        prisma.appliedVacancy.count({
            where: {
                userId,
                status: { in: ["POSITIVE_RESPONSE", "RECRUITER_MESSAGE", "ACTION_REQUIRED"] },
            },
        }),
        prisma.appliedVacancy.count({ where: { userId, status: "REJECTION" } }),
        prisma.appliedVacancy.count({
            where: {
                userId,
                status: { in: ["ATTEMPTED", "APPLIED", "APPLICATION_RECEIVED", "APPLICATION_VIEWED"] },
            },
        }),
        prisma.emailEvent.count({ where: { userId } }),
    ]);

    const generatedResumes = generatedResumesResult.status === "fulfilled" ? generatedResumesResult.value : 0;
    const sentMatches = sentMatchesResult.status === "fulfilled" ? sentMatchesResult.value : 0;
    const positiveVacancies = positiveVacanciesResult.status === "fulfilled" ? positiveVacanciesResult.value : 0;
    const negativeVacancies = negativeVacanciesResult.status === "fulfilled" ? negativeVacanciesResult.value : 0;
    const noResponseVacancies = noResponseVacanciesResult.status === "fulfilled" ? noResponseVacanciesResult.value : 0;
    const emailEvents = emailEventsResult.status === "fulfilled" ? emailEventsResult.value : 0;
    const sent = Math.max(sentMatches, positiveVacancies + negativeVacancies + noResponseVacancies);

    return {
        success: true,
        generatedResumes,
        sent,
        positive: positiveVacancies,
        negative: negativeVacancies,
        noResponse: Math.max(noResponseVacancies, sent - positiveVacancies - negativeVacancies),
        emailEvents,
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
