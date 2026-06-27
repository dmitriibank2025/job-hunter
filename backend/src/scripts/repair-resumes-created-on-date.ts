import { prisma } from "../infrastructure/prisma";
import { regenerateResumeVersion } from "../services/resume-generator.service";
import { validateResumeAgainstJob } from "../services/ats-resume-validator.service";

function requireDateArg(): string {
    const value = process.argv[2]?.trim();
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error("Usage: tsx src/scripts/repair-resumes-created-on-date.ts YYYY-MM-DD");
    }

    return value;
}

async function main() {
    const date = requireDateArg();
    const start = new Date(`${date}T00:00:00+03:00`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    const resumes = await prisma.resumeVersion.findMany({
        where: {
            createdAt: {
                gte: start,
                lt: end,
            },
        },
        include: {
            job: {
                select: {
                    id: true,
                    externalJobId: true,
                    title: true,
                    company: true,
                    location: true,
                    url: true,
                    normalizedUrl: true,
                    fingerprint: true,
                    postedAt: true,
                    description: true,
                    source: true,
                    status: true,
                    createdAt: true,
                    updatedAt: true,
                },
            },
        },
        orderBy: {
            createdAt: "asc",
        },
    });

    console.log(`Found ${resumes.length} resume versions created on ${date} Asia/Jerusalem.`);

    let repaired = 0;
    const failed: Array<{ id: string; title: string; company: string; error: string }> = [];
    const atsResults: Array<{
        id: string;
        title: string;
        company: string;
        score: number;
        issues: string[];
        missingImportantKeywords: string[];
    }> = [];

    for (const resume of resumes) {
        const label = `${resume.job.title} @ ${resume.job.company ?? "Unknown"}`;
        process.stdout.write(`[${repaired + failed.length + 1}/${resumes.length}] Repairing ${label}... `);

        try {
            const updated = await regenerateResumeVersion(resume.id, { skipTokenLimit: true });
            const ats = validateResumeAgainstJob(resume.job, updated.content);
            atsResults.push({
                id: resume.id,
                title: resume.job.title,
                company: resume.job.company ?? "Unknown",
                score: ats.score,
                issues: ats.issues,
                missingImportantKeywords: ats.missingImportantKeywords,
            });
            repaired += 1;
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

    const atsFailures = atsResults.filter((result) => result.score < 75 || result.issues.length > 0);

    console.log(JSON.stringify({
        date,
        found: resumes.length,
        repaired,
        failed,
        ats: {
            minScore: atsResults.length ? Math.min(...atsResults.map((result) => result.score)) : null,
            averageScore: atsResults.length
                ? Math.round(atsResults.reduce((sum, result) => sum + result.score, 0) / atsResults.length)
                : null,
            failures: atsFailures,
        },
    }, null, 2));

    if (failed.length > 0 || atsFailures.length > 0) {
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
