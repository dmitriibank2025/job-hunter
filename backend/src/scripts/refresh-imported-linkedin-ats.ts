import { prisma } from "../infrastructure/prisma";
import {
    removeUnsupportedTechnologiesFromExperience,
    validateResumeAgainstJob,
} from "../services/ats-resume-validator.service";

type Options = {
    userId: string;
    limit: number;
    refreshDescriptions: boolean;
};

function parseArgs(): Options {
    const userId = process.argv.find((arg) => arg.startsWith("--user="))?.split("=")[1]?.trim();
    const limit = Number.parseInt(process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1] ?? "500", 10);

    if (!userId) {
        throw new Error("Usage: node dist/scripts/refresh-imported-linkedin-ats.js --user=USER_ID [--limit=N] [--skip-descriptions]");
    }

    return {
        userId,
        limit: Number.isFinite(limit) && limit > 0 ? limit : 500,
        refreshDescriptions: !process.argv.includes("--skip-descriptions"),
    };
}

function decodeHtml(value: string) {
    return value
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, "\"");
}

function htmlToText(value: string) {
    return decodeHtml(value)
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function textBetween(html: string, pattern: RegExp) {
    const match = pattern.exec(html);
    return match ? htmlToText(match[1] ?? "") : "";
}

async function fetchLinkedInDetail(jobId: string) {
    const response = await fetch(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${jobId}`, {
        headers: {
            "user-agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
                "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
        },
    });

    if (!response.ok) throw new Error(`LinkedIn detail failed: ${response.status}`);

    const html = await response.text();
    const description = textBetween(html, /<div[^>]*class="[^"]*show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (!description || description.length < 80) throw new Error("LinkedIn detail did not include a usable description");

    return {
        title: textBetween(html, /<h2[^>]*topcard__title[^>]*>([\s\S]*?)<\/h2>/i),
        company: textBetween(html, /topcard__org-name-link[^>]*>([\s\S]*?)<\/a>/i),
        location: textBetween(html, /topcard__flavor topcard__flavor--bullet[^>]*>([\s\S]*?)<\/span>/i),
        description: description.slice(0, 8_000),
    };
}

function recommendation(score: number, issuesCount: number) {
    if (score >= 80 && issuesCount <= 1) return "APPLY";
    if (score >= 65) return "MAYBE";
    return "SKIP";
}

async function main() {
    const options = parseArgs();
    const resumes = await prisma.resumeVersion.findMany({
        where: {
            userId: options.userId,
        },
        include: {
            job: true,
        },
        orderBy: { createdAt: "desc" },
        take: options.limit,
    });

    let refreshedDescriptions = 0;
    let descriptionFailures = 0;
    let updatedResumes = 0;
    let updatedMatches = 0;
    const scores: number[] = [];

    console.log(`Refreshing ATS/match for ${resumes.length} resumes. refreshDescriptions=${options.refreshDescriptions}`);

    for (const [index, resume] of resumes.entries()) {
        let job = resume.job;
        const label = `${job.company ?? "Unknown"} | ${job.title}`;
        process.stdout.write(`[${index + 1}/${resumes.length}] ${label}... `);

        if (
            options.refreshDescriptions
            && job.source === "STORAGE_IMPORT"
            && job.externalJobId
            && /^\d+$/.test(job.externalJobId)
        ) {
            try {
                const detail = await fetchLinkedInDetail(job.externalJobId);
                job = await prisma.job.update({
                    where: { id: job.id },
                    data: {
                        title: detail.title || job.title,
                        company: detail.company || job.company,
                        location: detail.location || job.location,
                        description: detail.description,
                        status: "ANALYZED",
                    },
                });
                refreshedDescriptions += 1;
                await new Promise((resolve) => setTimeout(resolve, 350));
            } catch (error) {
                descriptionFailures += 1;
            }
        }

        const cleanedContent = removeUnsupportedTechnologiesFromExperience(resume.content);
        const ats = validateResumeAgainstJob(job, cleanedContent);
        const nextRecommendation = recommendation(ats.score, ats.issues.length);

        await prisma.resumeVersion.update({
            where: { id: resume.id },
            data: {
                content: cleanedContent,
                atsScore: ats.score,
                atsIssues: ats.issues,
                atsMatchedKeywords: ats.matchedKeywords,
                atsMissingKeywords: ats.missingImportantKeywords,
                atsValidatedAt: new Date(),
            },
        });
        updatedResumes += 1;
        scores.push(ats.score);

        await prisma.userJobMatch.upsert({
            where: {
                userId_jobId: {
                    userId: options.userId,
                    jobId: job.id,
                },
            },
            create: {
                userId: options.userId,
                jobId: job.id,
                status: "ANALYZED",
                matchScore: ats.score,
                matchedAt: new Date(),
                analysis: {
                    source: "ATS_REFRESH",
                    recommendation: nextRecommendation,
                    reason: `ATS validation score ${ats.score}/100 using ${job.source === "STORAGE_IMPORT" && /^\d+$/.test(job.externalJobId ?? "") ? "LinkedIn detail" : "stored vacancy metadata"}.`,
                    matchedSkills: ats.matchedKeywords,
                    missingSkills: ats.missingImportantKeywords,
                    rejectionRisk: ats.issues,
                },
            },
            update: {
                status: "ANALYZED",
                matchScore: ats.score,
                matchedAt: new Date(),
                analysis: {
                    source: "ATS_REFRESH",
                    recommendation: nextRecommendation,
                    reason: `ATS validation score ${ats.score}/100 using ${job.source === "STORAGE_IMPORT" && /^\d+$/.test(job.externalJobId ?? "") ? "LinkedIn detail" : "stored vacancy metadata"}.`,
                    matchedSkills: ats.matchedKeywords,
                    missingSkills: ats.missingImportantKeywords,
                    rejectionRisk: ats.issues,
                },
            },
        });
        updatedMatches += 1;

        console.log(`score=${ats.score} issues=${ats.issues.length}`);
    }

    console.log(JSON.stringify({
        checked: resumes.length,
        refreshedDescriptions,
        descriptionFailures,
        updatedResumes,
        updatedMatches,
        ats: {
            minScore: scores.length ? Math.min(...scores) : null,
            averageScore: scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null,
            maxScore: scores.length ? Math.max(...scores) : null,
        },
    }, null, 2));
}

main()
    .catch((error) => {
        console.error(error instanceof Error ? error.stack ?? error.message : error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
