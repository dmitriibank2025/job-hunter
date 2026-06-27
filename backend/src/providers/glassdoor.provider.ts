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

            // Одна страница для всех поисковых URL
            const searchPage = await context.newPage();
            const cards: GlassdoorCard[] = [];
            const seenUrls = new Set<string>();

            try {
                for (const searchUrl of glassdoorSearchUrls()) {
                    console.log(`[Glassdoor] Scanning: ${searchUrl}`);

                    await searchPage.goto(searchUrl, {
                        waitUntil: "domcontentloaded",
                        timeout: 60_000,
                    });

                    // Ждём реальный элемент вместо фиксированного sleep
                    await searchPage
                        .waitForSelector(
                            "li[data-test*='job'], div[data-test*='job'], a[href*='/job-listing/']",
                            { timeout: 10_000 },
                        )
                        .catch(() => null);

                    // Передаём скрипт строкой — не затрагивается бандлером
                    const rawCards = await searchPage.evaluate(
                        ([script, max]) => {
                            // eslint-disable-next-line no-new-func
                            const fn = new Function(`${script}; return extractGlassdoorCards;`)();
                            return fn(max) as RawGlassdoorCard[];
                        },
                        [EXTRACT_CARDS_SCRIPT, MAX_CARDS_PER_PAGE] as const,
                    );

                    let newOnPage = 0;
                    for (const raw of rawCards) {
                        if (!raw.url || seenUrls.has(raw.url)) continue;
                        seenUrls.add(raw.url);
                        newOnPage++;
                        cards.push(raw);
                    }

                    console.log(
                        `[Glassdoor] ${searchUrl}: ${newOnPage} new cards, total=${cards.length}`,
                    );
                }
            } finally {
                await searchPage.close();
            }

            // Одна страница для деталей — переиспользуется
            const jobs: ParsedJob[] = [];
            const detailPage = await context.newPage();

            try {
                for (let index = 0; index < cards.length; index++) {
                    const card = cards[index];
                    if (!card.url) continue;

                    if (!shouldFetchProviderDetails()) {
                        jobs.push({
                            title: card.title,
                            company: card.company,
                            location: card.location ?? DEFAULT_SEARCH_LOCATION,
                            url: card.url,
                            postedAt: parsePostedAt(card.postedAt),
                            source: "GLASSDOOR",
                            description: cardDescription(card),
                        });
                        continue;
                    }

                    try {
                        await detailPage.goto(card.url, {
                            waitUntil: "domcontentloaded",
                            timeout: 60_000,
                        });

                        const description = await extractDescription(detailPage, [
                            "[data-test='jobDescriptionContent']",
                            ".jobDescriptionContent",
                            "[class*='JobDescription']",
                            "main",
                        ]);

                        jobs.push({
                            title: card.title,
                            company: card.company,
                            location: card.location ?? DEFAULT_SEARCH_LOCATION,
                            url: card.url,
                            postedAt: parsePostedAt(card.postedAt),
                            source: "GLASSDOOR",
                            description: description ?? cardDescription(card),
                        });

                    } catch (error) {
                        console.error(`[Glassdoor] Failed details for ${card.url}:`, error);

                        // Не теряем карточку при ошибке — сохраняем с fallback
                        jobs.push({
                            title: card.title,
                            company: card.company,
                            location: card.location ?? DEFAULT_SEARCH_LOCATION,
                            url: card.url,
                            postedAt: parsePostedAt(card.postedAt),
                            source: "GLASSDOOR",
                            description: cardDescription(card),
                        });
                    }

                    if (index < cards.length - 1) {
                        await sleep(DETAIL_THROTTLE_MS);
                    }
                }
            } finally {
                await detailPage.close();
            }

            return filterRelevantJobs(jobs);

        } finally {
            // Браузер закрывается всегда — даже при необработанном исключении
            await browser?.close();
        }
    }
}
