import { prisma } from "../infrastructure/prisma";
import {
    removeUnsupportedTechnologiesFromExperience,
    validateResumeAgainstJob,
} from "../services/ats-resume-validator.service";

function parseLimit(): number | undefined {
    const raw = process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1];
    if (!raw) return undefined;

    const limit = Number.parseInt(raw, 10);
    if (!Number.isFinite(limit) || limit <= 0) {
        throw new Error("Usage: tsx src/scripts/backfill-resume-ats-scores.ts [--limit=N]");
    }

    return limit;
}

async function main() {
    const limit = parseLimit();
    const resumes = await prisma.resumeVersion.findMany({
        take: limit,
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

    let updated = 0;
    let cleanedContent = 0;
    const scores: number[] = [];
    const failures: Array<{ id: string; title: string; company: string; error: string }> = [];

    console.log(`Found ${resumes.length} resume versions for ATS backfill.`);

    for (const resume of resumes) {
        const label = `${resume.job.title} @ ${resume.job.company ?? "Unknown"}`;
        process.stdout.write(`[${updated + failures.length + 1}/${resumes.length}] ATS ${label}... `);

        try {
            const cleaned = removeUnsupportedTechnologiesFromExperience(resume.content);
            const ats = validateResumeAgainstJob(resume.job, cleaned);
            const contentChanged = cleaned !== resume.content;

            await prisma.resumeVersion.update({
                where: { id: resume.id },
                data: {
                    content: cleaned,
                    atsScore: ats.score,
                    atsIssues: ats.issues,
                    atsMatchedKeywords: ats.matchedKeywords,
                    atsMissingKeywords: ats.missingImportantKeywords,
                    atsValidatedAt: new Date(),
                },
            });

            updated += 1;
            scores.push(ats.score);
            if (contentChanged) cleanedContent += 1;
            console.log(`ok score=${ats.score}${ats.issues.length ? ` issues=${ats.issues.length}` : ""}${contentChanged ? " cleaned" : ""}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            failures.push({
                id: resume.id,
                title: resume.job.title,
                company: resume.job.company ?? "Unknown",
                error: message,
            });
            console.log(`failed: ${message}`);
        }
    }

    const summary = {
        found: resumes.length,
        updated,
        cleanedContent,
        failed: failures,
        ats: {
            minScore: scores.length ? Math.min(...scores) : null,
            averageScore: scores.length
                ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
                : null,
            maxScore: scores.length ? Math.max(...scores) : null,
        },
    };

    console.log(JSON.stringify(summary, null, 2));

    if (failures.length > 0) {
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
