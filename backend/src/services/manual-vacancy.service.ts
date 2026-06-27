import { prisma } from "../infrastructure/prisma";
import {
    createProviderBrowser,
    extractDescription,
    newProviderPage,
} from "../providers/browser-provider-utils";
import { createJobIfNew } from "./job-deduplication.service";
import { analyzeJob } from "./job-analyzer.service";
import {
    generateCoverLetterForJob,
    generateResumeForJob,
} from "./resume-generator.service";
import { createJobSchema } from "../validation";
import type { ResumeBaseSelectionMap } from "./resume-base-selector.service";

export type ManualVacancyInput = {
    title?: string;
    externalJobId?: string;
    company?: string;
    location?: string;
    url?: string;
    description?: string;
    resumeBaseId?: string;
    resumeBaseIds?: ResumeBaseSelectionMap;
};

export type ExtractedManualVacancy = {
    title?: string;
    company?: string;
    location?: string;
    description?: string;
};

function cleanPageText(value?: string | null): string | undefined {
    const text = value?.replace(/\s+/g, " ").trim();
    return text || undefined;
}

function inferTitleFromDescription(description: string): string {
    const lines = description
        .split(/\r?\n/)
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter(Boolean);

    const candidate = lines.find((line) =>
        line.length >= 4 &&
        line.length <= 120 &&
        !/^job description|about us|overview|responsibilities|requirements$/i.test(line)
    );

    return candidate || "Manual vacancy";
}

export function normalizeManualUrl(url?: string): string | undefined {
    if (!url) return undefined;

    const parsed = new URL(url);

    if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("Vacancy URL must start with http:// or https://.");
    }

    return parsed.toString();
}

async function getLocatorText(page: Awaited<ReturnType<typeof newProviderPage>>, selectors: string[]) {
    for (const selector of selectors) {
        const text = await page
            .locator(selector)
            .first()
            .textContent({ timeout: 2500 })
            .catch(() => null);

        const cleaned = cleanPageText(text);
        if (cleaned && cleaned.length >= 2) return cleaned;
    }

    return undefined;
}

async function getMetaContent(page: Awaited<ReturnType<typeof newProviderPage>>, selectors: string[]) {
    for (const selector of selectors) {
        const value = await page.locator(selector).first().getAttribute("content", { timeout: 1500 }).catch(() => null);
        const cleaned = cleanPageText(value);
        if (cleaned) return cleaned;
    }

    return undefined;
}

export async function extractManualVacancyFromUrl(url: string): Promise<ExtractedManualVacancy> {
    const browser = await createProviderBrowser({ timeoutMs: Number(process.env.MANUAL_JOB_BROWSER_TIMEOUT_MS ?? 45000) });
    const page = await newProviderPage(browser);

    try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: Number(process.env.MANUAL_JOB_PAGE_TIMEOUT_MS ?? 30000) });
        await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);

        const title =
            await getMetaContent(page, [
                "meta[property='og:title']",
                "meta[name='twitter:title']",
            ]) ||
            await getLocatorText(page, [
                "[data-testid*='job-title' i]",
                "[class*='job-title' i]",
                "[class*='position-title' i]",
                "h1",
                "title",
            ]);

        const company = await getMetaContent(page, [
            "meta[property='og:site_name']",
        ]) || await getLocatorText(page, [
            "[data-testid*='company' i]",
            "[class*='company-name' i]",
            "[class*='company' i]",
        ]);

        const location = await getLocatorText(page, [
            "[data-testid*='location' i]",
            "[class*='location' i]",
            "[class*='job-location' i]",
        ]);

        const description = await extractDescription(page, [
            "[data-testid*='description' i]",
            "[class*='job-description' i]",
            "[class*='description' i]",
            "[class*='job-details' i]",
            "[class*='posting' i]",
            "main",
            "article",
        ]);

        return {
            title: title ? title.split("|")[0].trim() : undefined,
            company,
            location,
            description,
        };
    } finally {
        await browser.close().catch(() => undefined);
    }
}

export async function processManualVacancy(userId: string, input: ManualVacancyInput) {
    const url = normalizeManualUrl(input.url);
    const extracted: ExtractedManualVacancy = url ? await extractManualVacancyFromUrl(url) : {};
    const description = input.description?.trim() || extracted.description?.trim();

    if (!description || description.length < 50) {
        throw new Error("Could not extract enough vacancy text. Paste the job description manually or use a direct vacancy page URL.");
    }

    const data = createJobSchema.parse({
        title: input.title || extracted.title || inferTitleFromDescription(description),
        externalJobId: input.externalJobId,
        company: input.company || extracted.company || "Manual vacancy",
        location: input.location || extracted.location,
        url,
        source: "MANUAL",
        description,
    });

    const result = await createJobIfNew(data);
    const analyzedJobs = [];
    const generatedResumes = [];
    const generatedCoverLetters = [];
    let message = result.isNew ? "Manual vacancy created." : "Manual vacancy already exists.";

    // Always ensure the user has a job match record — even if analysis fails later.
    // Without this, jobs created via manual entry become invisible in the user's list.
    const existingMatch = await prisma.userJobMatch.findFirst({
        where: { userId, jobId: result.job.id },
    });
    if (!existingMatch) {
        await prisma.userJobMatch.create({
            data: { userId, jobId: result.job.id, status: "NEW" },
        }).catch(() => undefined); // ignore race-condition duplicates
    }

    // Check per-user resume/cover letter counts before deciding what to generate.
    const [existingResumeCount, existingCoverLetterCount, alreadyAnalyzed] = await Promise.all([
        prisma.resumeVersion.count({ where: { userId, jobId: result.job.id } }),
        prisma.coverLetter.count({ where: { userId, jobId: result.job.id } }),
        prisma.userJobMatch.findFirst({
            where: { userId, jobId: result.job.id, matchScore: { not: null } },
        }),
    ]);

    try {
        // Skip re-analysis if already done for this user (saves tokens on re-submission).
        let analyzed;
        if (alreadyAnalyzed && !result.isNew) {
            analyzed = { ...result.job, matchScore: alreadyAnalyzed.matchScore, analysis: alreadyAnalyzed.analysis, userMatch: alreadyAnalyzed };
            message = `${message} Using existing analysis (score: ${alreadyAnalyzed.matchScore}).`;
        } else {
            analyzed = await analyzeJob(result.job.id, { userId, resumeBaseId: input.resumeBaseId, resumeBaseIds: input.resumeBaseIds });
        }
        analyzedJobs.push(analyzed);

        if (existingResumeCount === 0) {
            const [resume, coverLetter] = await Promise.all([
                generateResumeForJob(result.job.id, { userId, resumeBaseId: input.resumeBaseId, resumeBaseIds: input.resumeBaseIds }),
                existingCoverLetterCount === 0
                    ? generateCoverLetterForJob(result.job.id, { userId, resumeBaseId: input.resumeBaseId, resumeBaseIds: input.resumeBaseIds })
                    : Promise.resolve(null),
            ]);
            generatedResumes.push(resume);
            if (coverLetter) generatedCoverLetters.push(coverLetter);
            message = `${message} Resume and cover letter generated.`;
        } else if (existingCoverLetterCount === 0) {
            const coverLetter = await generateCoverLetterForJob(result.job.id, { userId, resumeBaseId: input.resumeBaseId, resumeBaseIds: input.resumeBaseIds });
            generatedCoverLetters.push(coverLetter);
            message = `${message} Existing resume kept. Cover letter generated.`;
        } else {
            message = `${message} Existing resume and cover letter kept.`;
        }
    } catch (error) {
        message = `${message} ${error instanceof Error ? error.message : "Analysis, resume, or cover letter generation failed."}`;
        console.error("[Manual Vacancy] Failed to process manual vacancy:", error);
    }

    const jobsForList = analyzedJobs.length ? analyzedJobs : [result.job];

    return {
        success: true,
        statusCode: result.isNew ? 201 : 200,
        collectedAt: new Date().toISOString(),
        searchLocation: data.location,
        sourceMode: "MANUAL",
        duplicate: !result.isNew,
        newJobsCount: result.isNew ? 1 : 0,
        analyzedJobsCount: analyzedJobs.length,
        generatedResumesCount: generatedResumes.length,
        generatedCoverLettersCount: generatedCoverLetters.length,
        message,
        newJobs: [result.job],
        analyzedJobs: jobsForList,
        generatedResumes,
        generatedCoverLetters,
    };
}
