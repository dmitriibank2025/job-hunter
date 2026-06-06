import { prisma } from "../infrastructure/prisma";
import { upsertUserJobMatch } from "./user-workspace.service";
import { slugify } from "./file-storage.service";
import fs from "fs/promises";
import path from "path";

export async function ensureUserJobMatchesForUserArtifacts(userId: string) {
    const [resumeVersions, coverLetters, applications] = await Promise.all([
        prisma.resumeVersion.findMany({
            where: { userId },
            select: { jobId: true },
        }),
        prisma.coverLetter.findMany({
            where: { userId },
            select: { jobId: true },
        }),
        prisma.application.findMany({
            where: { userId },
            select: { jobId: true },
        }),
    ]);

    const jobIds = [
        ...resumeVersions.map((item) => item.jobId),
        ...coverLetters.map((item) => item.jobId),
        ...applications.map((item) => item.jobId),
    ];
    const uniqueJobIds = [...new Set(jobIds)];

    if (!uniqueJobIds.length) {
        return { checked: 0, created: 0 };
    }

    const existingMatches = await prisma.userJobMatch.findMany({
        where: {
            userId,
            jobId: { in: uniqueJobIds },
        },
        select: { jobId: true },
    });
    const existingJobIds = new Set(existingMatches.map((item) => item.jobId));
    const missingJobIds = uniqueJobIds.filter((jobId) => !existingJobIds.has(jobId));

    for (const jobId of missingJobIds) {
        await upsertUserJobMatch(userId, jobId, {
            status: "NEW",
        });
    }

    return {
        checked: uniqueJobIds.length,
        created: missingJobIds.length,
    };
}

async function findJobByStorageFolder(folderSlug: string) {
    const jobs = await prisma.job.findMany({
        select: {
            id: true,
            title: true,
            company: true,
        },
    });

    return jobs.find((job) => slugify(`${job.company ?? "unknown"}-${job.title}`) === folderSlug) ?? null;
}

async function readTextIfExists(filePath: string) {
    try {
        return await fs.readFile(filePath, "utf-8");
    } catch {
        return "";
    }
}

export async function ensureUserDocumentForStoragePath(
    userId: string,
    normalizedRelativePath: string,
    absolutePath: string,
) {
    const normalized = normalizedRelativePath.replace(/\\/g, "/");
    const match = /^resumes\/(?:([0-9a-f-]{36})\/)?([^/]+)\/([^/]+)$/i.exec(normalized);
    if (!match) return null;

    const [, pathUserId, folderSlug, fileName] = match;
    if (pathUserId && pathUserId !== userId) return null;
    const folderPath = path.dirname(absolutePath);
    const job = await findJobByStorageFolder(folderSlug);
    if (!job) return null;

    const existingOtherResume = await prisma.resumeVersion.findFirst({
        where: {
            userId: { not: userId },
            OR: [
                { filePath: { endsWith: normalized } },
                { pdfFilePath: { endsWith: normalized } },
            ],
        },
        select: { id: true },
    });
    const existingOtherCoverLetter = await prisma.coverLetter.findFirst({
        where: {
            userId: { not: userId },
            filePath: { endsWith: normalized },
        },
        select: { id: true },
    });

    if (existingOtherResume || existingOtherCoverLetter) {
        return null;
    }

    await upsertUserJobMatch(userId, job.id, { status: "NEW" });

    if (/^cover-letter\./i.test(fileName)) {
        const coverLetterPath = path.join(folderPath, "cover-letter.docx");
        const content = await readTextIfExists(path.join(folderPath, "cover-letter.txt"));
        return prisma.coverLetter.upsert({
            where: {
                id: (await prisma.coverLetter.findFirst({
                    where: {
                        userId,
                        jobId: job.id,
                        filePath: { endsWith: "cover-letter.docx" },
                    },
                    select: { id: true },
                }))?.id ?? "__missing__",
            },
            create: {
                userId,
                jobId: job.id,
                content: content || "Legacy cover letter file.",
                filePath: coverLetterPath,
            },
            update: {
                filePath: coverLetterPath,
                content: content || undefined,
            },
        });
    }

    const docxPath = path.join(folderPath, fileName.replace(/\.(pdf|md)$/i, ".docx"));
    const pdfPath = path.join(folderPath, fileName.replace(/\.(docx|md)$/i, ".pdf"));
    const markdownPath = path.join(folderPath, fileName.replace(/\.(docx|pdf)$/i, ".md"));
    const content = await readTextIfExists(markdownPath);
    const existingResume = await prisma.resumeVersion.findFirst({
        where: {
            userId,
            jobId: job.id,
            OR: [
                { filePath: { endsWith: path.basename(docxPath) } },
                { pdfFilePath: { endsWith: path.basename(pdfPath) } },
            ],
        },
        select: { id: true },
    });

    return prisma.resumeVersion.upsert({
        where: {
            id: existingResume?.id ?? "__missing__",
        },
        create: {
            userId,
            jobId: job.id,
            content: content || "Legacy resume file.",
            format: "docx",
            filePath: docxPath,
            pdfFilePath: pdfPath,
        },
        update: {
            filePath: docxPath,
            pdfFilePath: pdfPath,
            content: content || undefined,
        },
    });
}
