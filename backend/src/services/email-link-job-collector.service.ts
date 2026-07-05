import { prisma } from "../infrastructure/prisma";
import { extractDescription, createProviderBrowser, newProviderPage, cleanJobTitle, filterRelevantJobs } from "../providers/browser-provider-utils";
import { ParsedJob } from "../providers/types";
import { createJobIfNew, findDuplicateJob, normalizeJobUrl } from "./job-deduplication.service";
import { extractUrls } from "./email-report.service";
import { updateAutomationProgress } from "./job-automation-progress.service";

type EmailEvent = Awaited<ReturnType<typeof prisma.emailEvent.findMany>>[number];

function reportLookbackDate(days = 1): Date {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function readRawText(event: EmailEvent): string {
    const raw = event.raw as Record<string, unknown> | null;
    const rawBody = typeof raw?.parsedBodyText === "string" ? raw.parsedBodyText : undefined;
    const rawSnippet = typeof raw?.parsedSnippet === "string" ? raw.parsedSnippet : undefined;

    return [rawBody, rawSnippet, event.bodyPreview, event.snippet]
        .filter((value): value is string => Boolean(value))
        .join("\n");
}

function normalizePageTitle(value?: string | null): string {
    return cleanJobTitle(
        (value ?? "")
            .replace(/\s*[|•·-].*$/, "")
            .trim(),
    );
}

async function textFromSelectors(page: Awaited<ReturnType<typeof newProviderPage>>, selectors: string[]): Promise<string | undefined> {
    for (const selector of selectors) {
        const text = await page
            .locator(selector)
            .first()
            .textContent({ timeout: 3000 })
            .catch(() => null);

        if (text?.trim()) return text.trim();
    }

    return undefined;
}

async function metaContent(page: Awaited<ReturnType<typeof newProviderPage>>, selector: string): Promise<string | undefined> {
    return page
        .locator(selector)
        .first()
        .getAttribute("content", { timeout: 3000 })
        .catch(() => null)
        .then((value) => value?.trim() || undefined);
}

async function inspectJobLink(
    url: string,
): Promise<ParsedJob | null> {
    const browser = await createProviderBrowser({ timeoutMs: 0 });
    const page = await newProviderPage(browser);

    try {
        await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 25000,
        });

        await page.waitForTimeout(1000);

        const resolvedUrl = normalizeJobUrl(page.url()) ?? url;
        const title =
            normalizePageTitle(
                (await textFromSelectors(page, [
                    "h1",
                    "[data-testid*='job-title']",
                    "[class*='job-title']",
                    "[class*='title']",
                ])) ??
                    (await metaContent(page, "meta[property='og:title']")) ??
                    (await page.title().catch(() => null)),
            ) ||
            normalizePageTitle(
                (await metaContent(page, "meta[name='twitter:title']")) ??
                    (await page.title().catch(() => null)),
            );

        const company =
            (await textFromSelectors(page, [
                "[data-testid*='company']",
                "[class*='company']",
                "a[href*='/company/']",
                "a[href*='/companies/']",
            ])) ??
            (await metaContent(page, "meta[property='og:site_name']")) ??
            new URL(resolvedUrl).hostname.replace(/^www\./, "");

        const location =
            (await textFromSelectors(page, [
                "[data-testid*='location']",
                "[class*='location']",
                "time + span",
            ])) ?? undefined;

        const description =
            (await extractDescription(page, [
                "[data-testid*='description']",
                ".job-description",
                ".jobDescription",
                "[class*='description']",
                "main",
            ])) ??
            (await page.locator("body").textContent({ timeout: 5000 }).catch(() => null))?.trim();

        const postedAtText =
            (await textFromSelectors(page, [
                "time",
                "[data-testid*='posted']",
                "[class*='posted']",
            ])) ?? undefined;

        const postedAt = postedAtText ? new Date(postedAtText) : undefined;

        const job: ParsedJob = {
            title: title || normalizePageTitle(await page.title().catch(() => null)) || resolvedUrl,
            company: company?.trim() || undefined,
            location: location?.trim() || undefined,
            url: resolvedUrl,
            postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : undefined,
            source: "EMAIL_LINK",
            description: description || `${title} ${company ?? ""} ${location ?? ""}`.trim(),
        };

        const relevant = filterRelevantJobs([job]);
        return relevant[0] ?? null;
    } catch {
        return null;
    } finally {
        await page.close().catch(() => undefined);
        await browser.close().catch(() => undefined);
    }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T | null> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), timeoutMs);
        promise
            .then((value) => {
                clearTimeout(timer);
                resolve(value);
            })
            .catch(() => {
                clearTimeout(timer);
                resolve(null);
            });
        timer.unref?.();
    });
}

export async function collectJobsFromEmailLinks(userId: string, gmailScanDays?: number): Promise<Array<Awaited<ReturnType<typeof createJobIfNew>>["job"]>> {
    const limit = Number(process.env.EMAIL_LINK_HISTORY_LIMIT ?? 200);
    const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 200;
    const events = await prisma.emailEvent.findMany({
        where: {
            userId,
            emailTs: {
                gte: reportLookbackDate(gmailScanDays),
            },
        },
        orderBy: {
            emailTs: "desc",
        },
        take: safeLimit,
    });

    const urls = new Set<string>();
    for (const event of events) {
        for (const url of extractUrls(readRawText(event))) {
            const normalized = normalizeJobUrl(url);
            if (!normalized || urls.has(normalized)) continue;
            urls.add(normalized);
        }
    }

    if (urls.size === 0) {
        return [];
    }

    const savedJobs: Array<Awaited<ReturnType<typeof createJobIfNew>>["job"]> = [];
    const urlList = [...urls];
    const timeoutMs = Number(process.env.EMAIL_LINK_JOB_TIMEOUT_MS ?? 30000);

    for (let index = 0; index < urlList.length; index++) {
        const url = urlList[index];
        updateAutomationProgress(userId, {
            stage: "Email links",
            message: `Inspecting email link ${index + 1}/${urlList.length}`,
            percent: 15 + Math.round((index / Math.max(urlList.length, 1)) * 10),
            currentStep: 2,
        });

        const existingByUrl = await findDuplicateJob({ url, title: "", description: "" });
        if (existingByUrl) continue;

        const job = await withTimeout(inspectJobLink(url), Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30000, url);
        if (!job) continue;

        const result = await createJobIfNew(job);
        if (result.isNew || result.shouldProcess) {
            savedJobs.push(result.job);
        }
    }

    const seen = new Set<string>();
    return savedJobs.filter((job) => {
        if (seen.has(job.id)) return false;
        seen.add(job.id);
        return true;
    });
}
