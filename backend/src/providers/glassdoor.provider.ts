import { Browser } from "playwright";
import { JobProvider } from "./job-provider";
import { ParsedJob } from "./types";
import {
    DEFAULT_SEARCH_LOCATION,
    cardDescription,
    createProviderBrowser,
    hasGlassdoorStorageState,
    extractDescription,
    filterRelevantJobs,
    getGlassdoorStorageStatePath,
    newProviderContext,
    parsePostedAt,
    shouldFetchProviderDetails,
} from "./browser-provider-utils";

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const DEFAULT_GLASSDOOR_SEARCH_URLS = [
    "https://www.glassdoor.com/Job/israel-full-stack-jobs-SRCH_IL.0,6_IN119_KO7,17.htm?fromAge=1",
    "https://www.glassdoor.com/Job/israel-backend-jobs-SRCH_IL.0,6_IN119_KO7,14.htm?fromAge=1",
    "https://www.glassdoor.com/Job/israel-frontend-developer-jobs-SRCH_IL.0,6_IN119_KO7,25.htm?fromAge=1",
    "https://www.glassdoor.com/Job/israel-node-js-developer-jobs-SRCH_IL.0,6_IN119_KO7,24.htm?fromAge=1",
];

// Максимум карточек на страницу — Glassdoor обычно показывает 30
const MAX_CARDS_PER_PAGE = 30;

// Задержка между деталями (мс)
const DETAIL_THROTTLE_MS = 600;

// ─── TYPES ────────────────────────────────────────────────────────────────────

type GlassdoorCard = {
    title: string;
    company?: string;
    location?: string;
    url?: string;
    postedAt?: string;
};

type RawGlassdoorCard = {
    title: string;
    company?: string;
    location?: string;
    url?: string;
    postedAt?: string;
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function glassdoorSearchUrls(): string[] {
    const configured = process.env.GLASSDOOR_SEARCH_URLS ?? process.env.GLASSDOOR_SEARCH_URL;

    if (!configured) return DEFAULT_GLASSDOOR_SEARCH_URLS;

    return configured.split(/[\n;]/).map((u) => u.trim()).filter(Boolean);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Glassdoor serves an anti-bot interstitial whose body text we must never store
// as a job description.
function isChallengeText(text: string | undefined): boolean {
    if (!text) return false;
    const t = text.toLowerCase();
    return (
        t.includes("humans only") ||
        t.includes("verify you are a human") ||
        t.includes("help us protect glassdoor") ||
        t.includes("please verify you're a human")
    );
}

// Glassdoor job-listing URLs carry the listing id as `?jl=<digits>`; we use it
// to locate the matching card anchor on the SERP for clicking.
function jobListingId(url?: string): string | undefined {
    if (!url) return undefined;
    const m = /[?&]jl=(\d+)/.exec(url);
    return m?.[1];
}

// ─── EXTRACT CARDS SCRIPT ─────────────────────────────────────────────────────
// Передаётся как строка чтобы избежать __name от esbuild (см. linkedin.provider.ts)

const EXTRACT_CARDS_SCRIPT = /* javascript */ `
function extractGlassdoorCards(maxCards) {
    var seen = new Set();

    function text(el, selector) {
        var found = el.querySelector(selector);
        return found ? (found.textContent || "").trim() || undefined : undefined;
    }

    var elements = Array.from(document.querySelectorAll(
        "li[data-test*='job'], div[data-test*='job'], a[href*='/job-listing/']"
    ));

    var results = [];

    for (var i = 0; i < elements.length && results.length < maxCards; i++) {
        var el = elements[i];

        var link = (el.tagName === "A" && el.href && el.href.includes("/job-listing/"))
            ? el
            : el.querySelector("a[href*='/job-listing/']") || el.querySelector("a[href]");

        var title =
            text(el, "[data-test='job-title']") ||
            text(el, ".job-title") ||
            text(el, "[class*='JobTitle']") ||
            (link ? (link.textContent || "").trim() : "") ||
            "";

        if (!title || /^jobs$/i.test(title)) continue;

        var url = link ? link.href : undefined;
        if (!url || !url.includes("/job-listing/") || seen.has(url)) continue;
        seen.add(url);

        var company =
            text(el, "[data-test='employer-name']") ||
            text(el, ".employer-name") ||
            text(el, "[class*='EmployerName']");

        var location =
            text(el, "[data-test='job-location']") ||
            text(el, ".location") ||
            text(el, "[class*='JobLocation']");

        var timeEl = el.querySelector("time");
        var postedAt =
            (timeEl ? timeEl.getAttribute("datetime") : undefined) ||
            (timeEl ? (timeEl.textContent || "").trim() : undefined) ||
            text(el, "[data-test*='job-age']") ||
            text(el, "[class*='JobAge']");

        results.push({
            title: title,
            company: company,
            location: location,
            url: url,
            postedAt: postedAt || undefined,
        });
    }

    return results;
}
`;

// ─── PROVIDER ─────────────────────────────────────────────────────────────────

export class GlassdoorProvider implements JobProvider {
    source = "GLASSDOOR";

    async search(): Promise<ParsedJob[]> {
        let browser: Browser | null = null;

        try {
            browser = await createProviderBrowser();
            const context = await newProviderContext(browser, {
                storageState: hasGlassdoorStorageState()
                    ? getGlassdoorStorageStatePath()
                    : undefined,
            });

            // Single SERP page: collect cards AND read each description from the
            // in-page side panel. Glassdoor renders the full description
            // (div.JobDetails_jobDescription) on the SERP when a card is clicked,
            // so we avoid navigating to per-listing detail URLs which trigger the
            // "Humans only" anti-bot interstitial.
            const searchPage = await context.newPage();
            const jobs: ParsedJob[] = [];
            const seenUrls = new Set<string>();

            const DESC_SELECTOR = "[class*='JobDetails_jobDescription'], [data-test='jobDescriptionContent'], [class*='jobDescription']";

            try {
                for (const searchUrl of glassdoorSearchUrls()) {
                    console.log(`[Glassdoor] Scanning: ${searchUrl}`);

                    await searchPage.goto(searchUrl, {
                        waitUntil: "domcontentloaded",
                        timeout: 60_000,
                    });

                    await searchPage
                        .waitForSelector(
                            "li[data-test*='job'], div[data-test*='job'], a[href*='/job-listing/']",
                            { timeout: 10_000 },
                        )
                        .catch(() => null);

                    const rawCards = await searchPage.evaluate(
                        ([script, max]) => {
                            // eslint-disable-next-line no-new-func
                            const fn = new Function(`${script}; return extractGlassdoorCards;`)();
                            return fn(max) as RawGlassdoorCard[];
                        },
                        [EXTRACT_CARDS_SCRIPT, MAX_CARDS_PER_PAGE] as const,
                    );

                    let newOnPage = 0;
                    for (const card of rawCards) {
                        if (!card.url || seenUrls.has(card.url)) continue;
                        seenUrls.add(card.url);
                        newOnPage++;

                        let description: string | undefined;

                        if (shouldFetchProviderDetails()) {
                            const jlId = jobListingId(card.url);
                            try {
                                // Click the matching card so the description panel renders in-place.
                                const cardLink = jlId
                                    ? searchPage.locator(`a[href*="jl=${jlId}"]`).first()
                                    : searchPage.locator(`a[href="${card.url}"]`).first();
                                await cardLink.click({ timeout: 8_000 });

                                // Wait for the panel to (re)populate with this listing's description.
                                await searchPage.waitForSelector(DESC_SELECTOR, { timeout: 8_000 }).catch(() => null);
                                await sleep(600); // allow panel content to swap

                                const panelText = await searchPage
                                    .locator(DESC_SELECTOR)
                                    .first()
                                    .textContent({ timeout: 5_000 })
                                    .catch(() => null);

                                const trimmed = panelText?.trim();
                                if (trimmed && trimmed.length >= 80 && !isChallengeText(trimmed)) {
                                    description = trimmed;
                                }
                            } catch (error) {
                                console.error(`[Glassdoor] panel description failed for ${card.url}:`, (error as Error).message);
                            }
                        }

                        jobs.push({
                            title: card.title,
                            company: card.company,
                            location: card.location ?? DEFAULT_SEARCH_LOCATION,
                            url: card.url,
                            postedAt: parsePostedAt(card.postedAt),
                            source: "GLASSDOOR",
                            description: description ?? cardDescription(card),
                        });

                        await sleep(DETAIL_THROTTLE_MS);
                    }

                    console.log(
                        `[Glassdoor] ${searchUrl}: ${newOnPage} new cards, total=${jobs.length}`,
                    );
                }
            } finally {
                await searchPage.close();
            }

            return filterRelevantJobs(jobs);

        } finally {
            // Браузер закрывается всегда — даже при необработанном исключении
            await browser?.close();
        }
    }
}
