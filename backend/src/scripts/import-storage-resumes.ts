import fs from "fs/promises";
import path from "path";
import { prisma } from "../infrastructure/prisma";
import { slugify } from "../services/file-storage.service";
import { validateResumeAgainstJob } from "../services/ats-resume-validator.service";

type ImportOptions = {
    targetUserId: string;
    roots: string[];
    dryRun: boolean;
};

const ROLE_STARTS = [
    "sr-engineer",
    "senior-backend",
    "senior-frontend",
    "senior-full-stack",
    "senior-fullstack",
    "senior-angular",
    "senior-principal",
    "senior-staff",
    "full-stack",
    "fullstack",
    "front-end",
    "frontend",
    "backend",
    "back-end",
    "lead-software",
    "senior-software",
    "software-engineer",
    "software-development-engineer",
    "software-developer",
    "devops",
    "sre",
    "security-engineer",
    "data-software",
    "data-analyst",
    "ai-engineer",
    "ai-full-stack",
    "golang-software",
    "python-software",
    "angular-developer",
    "solutions-engineer",
    "professional-services-engineer",
    "junior-backend",
    "team-lead",
    "principal-software",
    "staff-software",
];

function parseArgs(): ImportOptions {
    const targetUserId = process.argv.find((arg) => arg.startsWith("--target-user="))?.split("=")[1]?.trim();
    const rootsArg = process.argv.find((arg) => arg.startsWith("--roots="))?.slice("--roots=".length);
    const dryRun = process.argv.includes("--dry-run");

    if (!targetUserId || !rootsArg) {
        throw new Error("Usage: node dist/scripts/import-storage-resumes.js --target-user=USER_ID --roots=/path/one,/path/two [--dry-run]");
    }

    return {
        targetUserId,
        roots: rootsArg.split(",").map((item) => item.trim()).filter(Boolean),
        dryRun,
    };
}

function titleCaseSlug(value: string) {
    return value
        .split("-")
        .filter(Boolean)
        .map((part) => {
            const lower = part.toLowerCase();
            if (["ai", "aws", "api", "sre", "ml", "ui", "ux", "qa", "llm", "ll"].includes(lower)) return lower.toUpperCase();
            if (["js", "ts"].includes(lower)) return lower.toUpperCase();
            return lower.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join(" ");
}

function splitSlug(slug: string) {
    const match = ROLE_STARTS
        .map((start) => ({ start, index: slug.indexOf(start) }))
        .filter((item) => item.index > 0)
        .sort((a, b) => a.index - b.index)[0];

    if (!match) {
        const [company = "Imported", ...rest] = slug.split("-");
        return {
            company: titleCaseSlug(company),
            title: titleCaseSlug(rest.join("-") || slug),
        };
    }

    return {
        company: titleCaseSlug(slug.slice(0, match.index).replace(/-$/, "")),
        title: titleCaseSlug(slug.slice(match.index)),
    };
}

async function readTextIfExists(filePath: string) {
    try {
        return await fs.readFile(filePath, "utf-8");
    } catch {
        return "";
    }
}

async function fileExists(filePath: string) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

function extractCompanyFromCoverLetter(content: string) {
    const patterns = [
        /\bposition at ([A-Z][A-Za-z0-9&' -]{1,80}?)(?:\.|,|\n)/,
        /\bapply(?:ing)? for .*? at ([A-Z][A-Za-z0-9&' -]{1,80}?)(?:\.|,|\n)/,
        /\bjoin ([A-Z][A-Za-z0-9&' -]{1,80}?)(?:\.|,|\n)/,
    ];

    for (const pattern of patterns) {
        const match = pattern.exec(content);
        const company = match?.[1]?.trim().replace(/\s+team$/i, "");
        if (company && company.length <= 80) return company;
    }

    return null;
}

async function listDirectories(root: string) {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, entry.name))
        .sort();
}

async function pickResumeMarkdown(folderPath: string) {
    const entries = await fs.readdir(folderPath);
    const markdowns = entries.filter((entry) => /\.md$/i.test(entry));
    return markdowns.find((entry) => /^CV_Dmitrii_Bank_/i.test(entry))
        ?? markdowns.find((entry) => /^resume\.md$/i.test(entry))
        ?? markdowns[0]
        ?? null;
}

async function pairedPath(folderPath: string, markdownName: string, extension: "docx" | "pdf") {
    const preferred = path.join(folderPath, markdownName.replace(/\.md$/i, `.${extension}`));
    if (await fileExists(preferred)) return preferred;

    const fallback = path.join(folderPath, `resume.${extension}`);
    if (await fileExists(fallback)) return fallback;

    const entries = await fs.readdir(folderPath);
    const first = entries.find((entry) => new RegExp(`\\.${extension}$`, "i").test(entry) && !/^cover-letter\./i.test(entry));
    return first ? path.join(folderPath, first) : null;
}

async function findExistingJobByFolderSlug(folderSlug: string) {
    const jobs = await prisma.job.findMany({
        select: {
            id: true,
            title: true,
            company: true,
        },
    });

    return jobs.find((job) => slugify(`${job.company ?? "unknown"}-${job.title}`) === folderSlug) ?? null;
}

async function importFolder(targetUserId: string, folderPath: string, dryRun: boolean) {
    const folderSlug = path.basename(folderPath);
    const markdownName = await pickResumeMarkdown(folderPath);
    if (!markdownName) return { imported: false, skipped: true, reason: "no markdown resume" };

    const markdownPath = path.join(folderPath, markdownName);
    const content = await readTextIfExists(markdownPath);
    const coverLetterTextPath = path.join(folderPath, "cover-letter.txt");
    const coverLetterContent = await readTextIfExists(coverLetterTextPath);
    const parsed = splitSlug(folderSlug);
    const coverCompany = extractCompanyFromCoverLetter(coverLetterContent);
    const title = parsed.title;
    const company = coverCompany ?? parsed.company;
    const description = [
        `Imported from storage folder: ${folderSlug}.`,
        `Recovered target role: ${title}.`,
        coverLetterContent ? `Recovered cover letter context:\n${coverLetterContent}` : "",
        content ? `Recovered resume content:\n${content.slice(0, 4000)}` : "",
    ].filter(Boolean).join("\n\n");
    const docxPath = await pairedPath(folderPath, markdownName, "docx");
    const pdfPath = await pairedPath(folderPath, markdownName, "pdf");
    const coverDocxPath = await fileExists(path.join(folderPath, "cover-letter.docx"))
        ? path.join(folderPath, "cover-letter.docx")
        : null;

    if (dryRun) {
        return {
            imported: true,
            skipped: false,
            company,
            title,
            folderSlug,
            hasDocx: Boolean(docxPath),
            hasPdf: Boolean(pdfPath),
            hasCoverLetter: Boolean(coverDocxPath || coverLetterContent),
        };
    }

    const existingJob = await findExistingJobByFolderSlug(folderSlug);
    const job = existingJob
        ? await prisma.job.update({
            where: { id: existingJob.id },
            data: {
                description,
                status: "SAVED",
            },
        })
        : await prisma.job.upsert({
            where: {
                source_externalJobId: {
                    source: "STORAGE_IMPORT",
                    externalJobId: folderSlug,
                },
            },
            create: {
                source: "STORAGE_IMPORT",
                externalJobId: folderSlug,
                title,
                company,
                description,
                status: "SAVED",
                fingerprint: `storage-import:${folderSlug}`,
            },
            update: {
                title,
                company,
                description,
                status: "SAVED",
            },
        });

    const ats = validateResumeAgainstJob(job, content);
    const existingResume = await prisma.resumeVersion.findFirst({
        where: {
            userId: targetUserId,
            jobId: job.id,
            OR: [
                { filePath: docxPath },
                { pdfFilePath: pdfPath },
                { filePath: { endsWith: `/${folderSlug}/${path.basename(docxPath ?? "")}` } },
            ],
        },
        select: { id: true },
    });

    await prisma.resumeVersion.upsert({
        where: { id: existingResume?.id ?? "__missing__" },
        create: {
            userId: targetUserId,
            jobId: job.id,
            content,
            format: "markdown",
            filePath: docxPath,
            pdfFilePath: pdfPath,
            atsScore: ats.score,
            atsIssues: ats.issues,
            atsMatchedKeywords: ats.matchedKeywords,
            atsMissingKeywords: ats.missingImportantKeywords,
            atsValidatedAt: new Date(),
        },
        update: {
            content,
            filePath: docxPath,
            pdfFilePath: pdfPath,
            atsScore: ats.score,
            atsIssues: ats.issues,
            atsMatchedKeywords: ats.matchedKeywords,
            atsMissingKeywords: ats.missingImportantKeywords,
            atsValidatedAt: new Date(),
        },
    });

    if (coverDocxPath || coverLetterContent) {
        const existingCoverLetter = await prisma.coverLetter.findFirst({
            where: {
                userId: targetUserId,
                jobId: job.id,
                OR: [
                    { filePath: coverDocxPath },
                    { filePath: { endsWith: `/${folderSlug}/cover-letter.docx` } },
                ],
            },
            select: { id: true },
        });

        await prisma.coverLetter.upsert({
            where: { id: existingCoverLetter?.id ?? "__missing__" },
            create: {
                userId: targetUserId,
                jobId: job.id,
                content: coverLetterContent || "Imported legacy cover letter file.",
                filePath: coverDocxPath,
            },
            update: {
                content: coverLetterContent || undefined,
                filePath: coverDocxPath,
            },
        });
    }

    await prisma.userJobMatch.upsert({
        where: {
            userId_jobId: {
                userId: targetUserId,
                jobId: job.id,
            },
        },
        create: {
            userId: targetUserId,
            jobId: job.id,
            status: "SAVED",
            matchScore: ats.score,
            matchedAt: new Date(),
            analysis: {
                source: "STORAGE_IMPORT",
                reason: "Imported from storage resume folder.",
                matchedSkills: ats.matchedKeywords,
                missingSkills: ats.missingImportantKeywords,
                recommendation: ats.issues.length ? "Review imported vacancy metadata" : "Review",
            },
        },
        update: {
            status: "SAVED",
            matchScore: ats.score,
            matchedAt: new Date(),
            analysis: {
                source: "STORAGE_IMPORT",
                reason: "Imported from storage resume folder.",
                matchedSkills: ats.matchedKeywords,
                missingSkills: ats.missingImportantKeywords,
                recommendation: ats.issues.length ? "Review imported vacancy metadata" : "Review",
            },
        },
    });

    return {
        imported: true,
        skipped: false,
        company,
        title,
        folderSlug,
        atsScore: ats.score,
        issues: ats.issues.length,
    };
}

async function main() {
    const options = parseArgs();
    const user = await prisma.appUser.findUnique({ where: { id: options.targetUserId }, select: { id: true, email: true } });
    if (!user) throw new Error(`Target user not found: ${options.targetUserId}`);

    let checked = 0;
    let imported = 0;
    let skipped = 0;
    const failures: Array<{ folder: string; error: string }> = [];

    for (const root of options.roots) {
        const folders = await listDirectories(root);
        console.log(`Scanning ${folders.length} folders in ${root}`);

        for (const folder of folders) {
            checked += 1;
            process.stdout.write(`[${checked}] ${path.basename(folder)}... `);
            try {
                const result = await importFolder(options.targetUserId, folder, options.dryRun);
                if (result.imported) {
                    imported += 1;
                    console.log(`ok ${"company" in result ? `${result.company} | ${result.title}` : ""}`);
                } else {
                    skipped += 1;
                    console.log(`skipped ${"reason" in result ? result.reason : ""}`);
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                failures.push({ folder, error: message });
                console.log(`failed: ${message}`);
            }
        }
    }

    console.log(JSON.stringify({
        targetUser: user.email,
        dryRun: options.dryRun,
        checked,
        imported,
        skipped,
        failures,
    }, null, 2));

    if (failures.length > 0) process.exitCode = 1;
}

main()
    .catch((error) => {
        console.error(error instanceof Error ? error.stack ?? error.message : error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
