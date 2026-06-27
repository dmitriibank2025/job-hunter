import { prisma } from "../infrastructure/prisma";
import { regenerateResumeVersion } from "../services/resume-generator.service";
import { inferResumeTargetForJob, ResumeBaseSelectionMap, selectResumeBaseForJob } from "../services/resume-base-selector.service";
import { validateResumeAgainstJob } from "../services/ats-resume-validator.service";

function argValue(name: string, fallback?: string) {
    const prefix = `--${name}=`;
    return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function hasFlag(name: string) {
    return process.argv.includes(`--${name}`);
}

async function main() {
    const userId = argValue("userId");
    if (!userId) {
        throw new Error("Usage: tsx src/scripts/regenerate-recent-resumes-with-daily-bases.ts --userId=<uuid> [--hours=24] [--limit=10] [--run]");
    }

    const hours = Number(argValue("hours", "24"));
    if (!Number.isFinite(hours) || hours <= 0) {
        throw new Error("--hours must be a positive number");
    }

    const limitValue = argValue("limit");
    const limit = limitValue ? Number(limitValue) : undefined;
    if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
        throw new Error("--limit must be a positive integer");
    }

    const run = hasFlag("run");
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const user = await prisma.appUser.findUniqueOrThrow({
        where: { id: userId },
        select: {
            id: true,
            email: true,
            dailyAutomationFullstackResumeBaseId: true,
            dailyAutomationBackendResumeBaseId: true,
            dailyAutomationFrontendResumeBaseId: true,
        },
    });

    const resumeBaseIds: ResumeBaseSelectionMap = {
        FULLSTACK: user.dailyAutomationFullstackResumeBaseId ?? undefined,
        BACKEND: user.dailyAutomationBackendResumeBaseId ?? undefined,
        FRONTEND: user.dailyAutomationFrontendResumeBaseId ?? undefined,
    };

    const resumes = await prisma.resumeVersion.findMany({
        where: {
            userId,
            createdAt: { gte: since },
        },
        include: { job: true },
        orderBy: { createdAt: "asc" },
        take: limit,
    });

    console.log(JSON.stringify({
        mode: run ? "run" : "dry-run",
        user: user.email,
        since: since.toISOString(),
        found: resumes.length,
        dailyResumeBaseIds: resumeBaseIds,
    }, null, 2));

    let regenerated = 0;
    const failed: Array<{ id: string; title: string; company: string; error: string }> = [];
    const results: Array<{
        id: string;
        title: string;
        company: string;
        target: string;
        resumeBaseId: string;
        resumeBaseName: string;
        atsScore?: number | null;
        atsIssues?: number;
    }> = [];

    for (const resume of resumes) {
        const target = inferResumeTargetForJob(resume.job);
        const selectedBase = await selectResumeBaseForJob(userId, resume.job, undefined, resumeBaseIds);
        const label = `${resume.job.title} @ ${resume.job.company ?? "Unknown"}`;
        process.stdout.write(`[${results.length + failed.length + 1}/${resumes.length}] ${run ? "Regenerating" : "Would regenerate"} ${label} -> ${target}/${selectedBase.name}... `);

        try {
            if (!run) {
                results.push({
                    id: resume.id,
                    title: resume.job.title,
                    company: resume.job.company ?? "Unknown",
                    target,
                    resumeBaseId: selectedBase.id,
                    resumeBaseName: selectedBase.name,
                });
                console.log("dry");
                continue;
            }

            const updated = await regenerateResumeVersion(resume.id, {
                resumeBaseId: selectedBase.id,
                skipTokenLimit: true,
            });
            const ats = validateResumeAgainstJob(resume.job, updated.content);
            regenerated += 1;
            results.push({
                id: resume.id,
                title: resume.job.title,
                company: resume.job.company ?? "Unknown",
                target,
                resumeBaseId: selectedBase.id,
                resumeBaseName: selectedBase.name,
                atsScore: ats.score,
                atsIssues: ats.issues.length,
            });
            console.log(`ok ATS=${ats.score}${ats.issues.length ? ` issues=${ats.issues.length}` : ""}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            failed.push({
                id: resume.id,
                title: resume.job.title,
                company: resume.job.company ?? "Unknown",
                error: message,
            });
            console.log(`failed: ${message}`);
        }
    }

    const byBase = results.reduce<Record<string, number>>((acc, result) => {
        const key = `${result.target}:${result.resumeBaseName}`;
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
    }, {});

    const atsScores = results
        .map((result) => result.atsScore)
        .filter((score): score is number => typeof score === "number");

    console.log(JSON.stringify({
        mode: run ? "run" : "dry-run",
        found: resumes.length,
        regenerated,
        failed,
        byBase,
        ats: atsScores.length ? {
            min: Math.min(...atsScores),
            average: Math.round(atsScores.reduce((sum, score) => sum + score, 0) / atsScores.length),
        } : null,
    }, null, 2));

    if (failed.length) {
        process.exitCode = 1;
    }
}

main()
    .catch((error) => {
        console.error(error instanceof Error ? error.stack ?? error.message : error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
