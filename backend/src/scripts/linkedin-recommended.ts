import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { chromium, Page } from "playwright";

const LINKEDIN_LOGIN_URL = "https://www.linkedin.com/login";
const LINKEDIN_RECOMMENDED_URL = "https://www.linkedin.com/jobs/collections/recommended";
const STORAGE_STATE_PATH = process.env.LINKEDIN_STORAGE_STATE ??
    path.join(process.cwd(), "storage", "linkedin_auth.json");
const OUTPUT_PATH = process.env.LINKEDIN_RECOMMENDED_OUTPUT ??
    path.join(process.cwd(), "storage", "linkedin_recommended_jobs.json");
const LINKEDIN_AUTH_TIMEOUT_MS = Number(process.env.LINKEDIN_AUTH_TIMEOUT_MS ?? 300000);

type LinkedInRecommendedJob = {
    title: string;
    company?: string;
    location?: string;
    url?: string;
    jobId?: string;
    metadata?: string;
};

async function pathExists(filePath: string): Promise<boolean> {
    return fs.access(filePath).then(() => true).catch(() => false);
}

async function saveSession() {
    await fs.mkdir(path.dirname(STORAGE_STATE_PATH), { recursive: true });

    const browser = await chromium.launch({
        headless: false,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(LINKEDIN_LOGIN_URL, { waitUntil: "domcontentloaded" });

    const email = process.env.LINKEDIN_EMAIL;
    const password = process.env.LINKEDIN_PASSWORD;

    if (email && password) {
        await page.fill("#username", email);
        await page.fill("#password", password);
        await page.click('button[type="submit"]');
    } else {
        console.log("Log in manually in the browser window.");
    }

    await page.waitForURL(/\/feed|\/jobs|\/mynetwork|\/in\//, { timeout: LINKEDIN_AUTH_TIMEOUT_MS });
    await context.storageState({ path: STORAGE_STATE_PATH });

    console.log(`LinkedIn session saved to ${STORAGE_STATE_PATH}`);
    await browser.close();
}

async function extractVisibleJobs(page: Page): Promise<LinkedInRecommendedJob[]> {
    const pageFunction = new Function(`return () => {
        const clean = (value) => value?.replace(/\s+/g, " ").trim() || undefined;
        const absoluteUrl = (value) => {
            if (!value) return undefined;

            try {
                const url = new URL(value, window.location.origin);
                url.hash = "";
                return url.toString();
            } catch {
                return undefined;
            }
        };
        const visible = (element) => {
            const box = element.getBoundingClientRect();

            return box.width > 0 &&
                box.height > 0 &&
                box.bottom >= 0 &&
                box.right >= 0 &&
                box.top <= window.innerHeight &&
                box.left <= window.innerWidth;
        };
        const selectors = [
            ".job-card-container",
            ".jobs-search-results__list-item",
            ".scaffold-layout__list-item",
            "[data-job-id]",
        ];
        const cards = Array.from(document.querySelectorAll(selectors.join(",")))
            .filter(visible);
        const jobs = [];
        const seen = new Set();

        for (const card of cards) {
            const link = card.querySelector(
                'a[href*="/jobs/view/"], a.job-card-container__link',
            );
            const url = absoluteUrl(link?.getAttribute("href"));
            const jobId =
                clean(card.getAttribute("data-job-id")) ||
                clean(card.getAttribute("data-occludable-job-id")) ||
                url?.match(new RegExp("/jobs/view/(\\\\d+)"))?.[1];
            const title = clean(
                card.querySelector(".job-card-list__title")?.textContent ||
                card.querySelector(".job-card-container__link")?.textContent ||
                link?.textContent,
            );
            const company = clean(
                card.querySelector(".job-card-container__primary-description")?.textContent ||
                card.querySelector(".artdeco-entity-lockup__subtitle")?.textContent,
            );
            const metadataItems = Array.from(card.querySelectorAll(
                ".job-card-container__metadata-item, .artdeco-entity-lockup__caption, .job-card-list__metadata",
            ))
                .map((item) => clean(item.textContent))
                .filter(Boolean);
            const location = metadataItems[0];
            const metadata = metadataItems.join(" | ") || clean(card.textContent);
            const key = jobId || url || [title, company, location].join("|");

            if (!title || seen.has(key)) continue;

            seen.add(key);
            jobs.push({
                title,
                company,
                location,
                url,
                jobId,
                metadata,
            });
        }

        return jobs;
    }`)() as () => LinkedInRecommendedJob[];

    return page.evaluate(pageFunction);
}

async function extractRecommendedJobs() {
    if (!await pathExists(STORAGE_STATE_PATH)) {
        throw new Error(`LinkedIn session not found: ${STORAGE_STATE_PATH}. Run npm run linkedin:auth first.`);
    }

    await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });

    const browser = await chromium.launch({
        headless: process.env.LINKEDIN_HEADLESS !== "false",
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const context = await browser.newContext({
        storageState: STORAGE_STATE_PATH,
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    try {
        await page.goto(LINKEDIN_RECOMMENDED_URL, {
            waitUntil: "domcontentloaded",
            timeout: 60000,
        });
        await page.waitForTimeout(4000);

        if (/\/login|checkpoint/i.test(page.url())) {
            throw new Error(`LinkedIn requires login/checkpoint. Refresh the session with npm run linkedin:auth. Current URL: ${page.url()}`);
        }

        await page.waitForSelector(
            '.job-card-container, .jobs-search-results__list-item, [data-job-id]',
            { timeout: 30000 },
        );

        const jobs = await extractVisibleJobs(page);

        await fs.writeFile(OUTPUT_PATH, JSON.stringify({
            extractedAt: new Date().toISOString(),
            sourceUrl: LINKEDIN_RECOMMENDED_URL,
            count: jobs.length,
            jobs,
        }, null, 2));

        console.log(JSON.stringify({ count: jobs.length, jobs, outputPath: OUTPUT_PATH }, null, 2));
    } finally {
        await browser.close();
    }
}

async function main() {
    const command = process.argv[2] ?? "extract";

    if (command === "auth") {
        await saveSession();
        return;
    }

    if (command === "extract") {
        await extractRecommendedJobs();
        return;
    }

    throw new Error(`Unknown command "${command}". Use "auth" or "extract".`);
}

void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
