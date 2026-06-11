import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../infrastructure/prisma";
import { createJobIfNew } from "../services/job-deduplication.service";
import { generateResumeForJob } from "../services/resume-generator.service";

const userId = process.env.E2E_USER_ID ?? "1711cddc-78cb-4cf9-af5c-ae15751af302";
const resumeBaseId = process.env.E2E_RESUME_BASE_ID ?? "3a87f3e6-44ac-4f2e-b4f9-335fdbc64983";
const searchUrl = process.env.E2E_LINKEDIN_SEARCH_URL ??
    "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=Full%20Stack&geoId=101620260&location=Israel&f_TPR=r86400&start=0";
const userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";

type FreshLinkedInJob = {
    linkedInJobId: string;
    title?: string;
    company?: string;
    location?: string;
    postedAt?: string;
    postedLabel?: string;
};

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
    return htmlToText(pattern.exec(html)?.[1] ?? "");
}

async function fetchHtml(url: string) {
    const response = await fetch(url, {
        headers: { "user-agent": userAgent },
    });

    if (!response.ok) {
        throw new Error(`LinkedIn request failed: ${response.status} ${url}`);
    }

    return response.text();
}

async function findFreshLinkedInJob(): Promise<FreshLinkedInJob> {
    if (process.env.E2E_LINKEDIN_JOB_ID) {
        return { linkedInJobId: process.env.E2E_LINKEDIN_JOB_ID };
    }

    const html = await fetchHtml(searchUrl);
    const cardPattern = /<div class="base-card[\s\S]*?data-entity-urn="urn:li:jobPosting:(\d+)"[\s\S]*?<\/li>/gi;
    let match: RegExpExecArray | null;

    while ((match = cardPattern.exec(html))) {
        const cardHtml = match[0];
        const postedAt = /<time[^>]*datetime="([^"]+)"/i.exec(cardHtml)?.[1];
        const postedLabel = textBetween(cardHtml, /<time[^>]*>([\s\S]*?)<\/time>/i);
        const hasFreshMarker = /job-search-card__listdate--new/i.test(cardHtml) || Boolean(postedAt);

        if (!hasFreshMarker) continue;

        return {
            linkedInJobId: match[1],
            title: textBetween(cardHtml, /base-search-card__title[^>]*>([\s\S]*?)<\/h3>/i),
            company: textBetween(cardHtml, /base-search-card__subtitle[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i),
            location: textBetween(cardHtml, /job-search-card__location[^>]*>([\s\S]*?)<\/span>/i),
            postedAt,
            postedLabel,
        };
    }

    throw new Error(`No fresh LinkedIn jobs found in ${searchUrl}`);
}

async function run() {
    const before = await prisma.resumeVersion.count({ where: { userId } });
    const freshJob = await findFreshLinkedInJob();
    const detailUrl = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${freshJob.linkedInJobId}`;
    const html = await fetchHtml(detailUrl);
    const title = textBetween(html, /<h2[^>]*topcard__title[^>]*>([\s\S]*?)<\/h2>/i) || freshJob.title || "LinkedIn job";
    const company = textBetween(html, /topcard__org-name-link[^>]*>([\s\S]*?)<\/a>/i) || freshJob.company || "LinkedIn company";
    const location = textBetween(html, /topcard__flavor topcard__flavor--bullet[^>]*>([\s\S]*?)<\/span>/i) || freshJob.location || "LinkedIn location";
    const description = textBetween(html, /<div[^>]*class="[^"]*show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
        htmlToText(html).slice(0, 4_000);

    if (description.length < 120) {
        throw new Error(`LinkedIn description too short: ${description.length}`);
    }

    const job = {
        title,
        company,
        location,
        url: `https://www.linkedin.com/jobs/view/${freshJob.linkedInJobId}/`,
        externalJobId: freshJob.linkedInJobId,
        source: "LINKEDIN",
        description,
    };

    console.log("REAL_LINKEDIN_JOB", JSON.stringify({
        title,
        company,
        location,
        url: job.url,
        descriptionLength: description.length,
        postedAt: freshJob.postedAt,
        postedLabel: freshJob.postedLabel,
        detailUrl,
    }, null, 2));

    const saved = await createJobIfNew(job);
    console.log("SAVED_JOB", JSON.stringify({
        id: saved.job.id,
        duplicate: !saved.isNew,
        shouldProcess: saved.shouldProcess,
        title: saved.job.title,
        company: saved.job.company,
        url: saved.job.url,
    }, null, 2));

    const resume = await generateResumeForJob(saved.job.id, { userId, resumeBaseId });
    const after = await prisma.resumeVersion.count({ where: { userId } });
    const pdfPath = resume.pdfFilePath
        ? path.isAbsolute(resume.pdfFilePath)
            ? resume.pdfFilePath
            : path.join(process.cwd(), resume.pdfFilePath)
        : null;

    console.log("RESUME_CREATED", JSON.stringify({
        id: resume.id,
        jobId: resume.jobId,
        filePath: resume.filePath,
        pdfFilePath: resume.pdfFilePath,
        contentLength: resume.content.length,
        fileExists: Boolean(resume.filePath && fs.existsSync(resume.filePath)),
        pdfExists: Boolean(pdfPath && fs.existsSync(pdfPath)),
        before,
        after,
    }, null, 2));
}

run()
    .catch((error) => {
        console.error("E2E_FAILED", error instanceof Error ? error.stack ?? error.message : error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
