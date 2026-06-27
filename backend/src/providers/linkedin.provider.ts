import fs from "fs";
import path from "path";
import { Browser, BrowserContext, chromium, Page } from "playwright";
import { prisma } from "../infrastructure/prisma";
import { JobProvider } from "./job-provider";
import { ParsedJob } from "./types";
import {
    DEFAULT_SEARCH_KEYWORD_QUERIES,
    cardDescription,
    getSearchLocation,
    filterRelevantJobs,
    shouldFetchProviderDetails,
} from "./browser-provider-utils";
import { updateAutomationProgress } from "../services/job-automation-progress.service";
import { resolveLinkedInStorageStatePath } from "../services/linkedin-account.service";
import { SearchPreferences } from "../services/search-preferences.service";

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const GEO_ID                 = process.env.LINKEDIN_GEO_ID       ?? "101620260";
const DISTANCE               = process.env.LINKEDIN_DISTANCE     ?? "25";
const LINKEDIN_TIME_FILTER   = process.env.LINKEDIN_TIME_FILTER  ?? "r86400";

const DEFAULT_LINKEDIN_SEARCH_URLS = [
    `https://www.linkedin.com/jobs/search/?keywords=Full%20Stack%20Developer&geoId=${GEO_ID}&distance=${DISTANCE}&f_TPR=${LINKEDIN_TIME_FILTER}`,
    `https://www.linkedin.com/jobs/search/?keywords=Backend%20Developer&geoId=${GEO_ID}&distance=${DISTANCE}&f_TPR=${LINKEDIN_TIME_FILTER}`,
    `https://www.linkedin.com/jobs/search/?keywords=Frontend%20Developer&geoId=${GEO_ID}&distance=${DISTANCE}&f_TPR=${LINKEDIN_TIME_FILTER}`,
    `https://www.linkedin.com/jobs/search/?keywords=Node.js%20Developer&geoId=${GEO_ID}&distance=${DISTANCE}&f_TPR=${LINKEDIN_TIME_FILTER}`,
    `https://www.linkedin.com/jobs/search/?keywords=React%20Developer&geoId=${GEO_ID}&distance=${DISTANCE}&f_TPR=${LINKEDIN_TIME_FILTER}`,
    `https://www.linkedin.com/jobs/search/?keywords=Senior%20Software%20Engineer&geoId=${GEO_ID}&distance=${DISTANCE}&f_TPR=${LINKEDIN_TIME_FILTER}`,
];

const LINKEDIN_STORAGE_STATE_PATH =
    process.env.LINKEDIN_STORAGE_STATE ??
    path.join(process.cwd(), "storage", "linkedin_auth.json");

const LINKEDIN_PAGE_SIZE          = toPositiveInt(process.env.LINKEDIN_PAGE_SIZE,          25);
const LINKEDIN_MAX_PAGES          = toPositiveInt(process.env.LINKEDIN_MAX_PAGES,          2);
const LINKEDIN_SEARCH_TIMEOUT_MS  = toPositiveInt(process.env.LINKEDIN_SEARCH_TIMEOUT_MS,  60_000);
const LINKEDIN_DETAIL_TIMEOUT_MS  = toPositiveInt(process.env.LINKEDIN_DETAIL_TIMEOUT_MS,  12_000);
const LINKEDIN_MAX_CARDS_PER_PAGE = toPositiveInt(process.env.LINKEDIN_MAX_CARDS_PER_PAGE, 25);
const LINKEDIN_EMPTY_PAGE_STOP    = toPositiveInt(process.env.LINKEDIN_EMPTY_PAGE_STOP,    2);
const LINKEDIN_EMPTY_PAGE_RETRIES = toPositiveInt(process.env.LINKEDIN_EMPTY_PAGE_RETRIES, 2);
const LINKEDIN_DETAIL_CONCURRENCY = toPositiveInt(process.env.LINKEDIN_DETAIL_CONCURRENCY, 1);
// В Docker нет XServer — headless по умолчанию.
// LINKEDIN_HEADLESS=false только для локальной отладки.
const LINUX_WITHOUT_DISPLAY = process.platform === "linux" && !process.env.DISPLAY;
const LINKEDIN_HEADLESS = LINUX_WITHOUT_DISPLAY || process.env.LINKEDIN_HEADLESS !== "false";

const DESCRIPTION_MIN_LENGTH = 300;
// Задержка между деталями: базовая + случайный джиттер до 2с
const DETAIL_THROTTLE_MS     = toPositiveInt(process.env.LINKEDIN_DETAIL_THROTTLE_MS, 1_000);
const DETAIL_JITTER_MAX_MS   = 2_000;

const WAIT_FOR_LIST_TIMEOUT_MS = 15_000;
const WAIT_AFTER_GOTO_MS       = 1_500;
const WAIT_AFTER_EMPTY_PAGE_MS = 3_000;

const LINKEDIN_PREFILTER_TITLE_PATTERNS = [
    /full[\s-]?stack/i,
    /fullstack/i,
    /back[\s-]?end/i,
    /backend/i,
    /front[\s-]?end/i,
    /frontend/i,
    /node\.?js/i,
    /react/i,
    /software\s+engineer/i,
];

const DESCRIPTION_SELECTORS = [
    ".jobs-description__content",
    ".jobs-box__html-content",
    ".jobs-description-content__text",
    ".show-more-less-html__markup",
    ".description__text",
] as const;

const JOB_CARD_SELECTOR = [
    "li.scaffold-layout__list-item[data-occludable-job-id]",
    "li[data-occludable-job-id]",
    "[data-job-id]",
    "[data-entity-urn*='urn:li:jobPosting:']",
    "a[href*='/jobs/view/']",
    "a[href*='currentJobId=']",
].join(",");

// Модальные диалоги которые мешают кликать
const MODAL_DISMISS_SELECTORS = [
    'button[aria-label="Dismiss"]',
    'button[aria-label="Close"]',
    ".modal__dismiss",
    ".contextual-sign-in-modal__modal-dismiss",
];

// ─── TYPES ────────────────────────────────────────────────────────────────────

type LinkedInJobCard = {
    title: string;
    company?: string;
    location?: string;
    url?: string;
    jobId?: string;
    searchUrl: string;
    postedAt?: string;
};

type RawCard = {
    title: string;
    company?: string;
    location?: string;
    url?: string;
    jobId?: string;
    postedAt?: string;
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function toPositiveInt(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function linkedInTimeFilter(preferences?: SearchPreferences): string {
    const days = Number(preferences?.dateRangeDays);
    if (!Number.isFinite(days) || days <= 0) return LINKEDIN_TIME_FILTER;
    if (days <= 1) return "r86400";
    if (days <= 7) return "r604800";
    if (days <= 30) return "r2592000";
    return LINKEDIN_TIME_FILTER;
}

// LinkedIn personalised "Top Applicant" collection — always scanned first
// because it shows roles where the candidate profile is a strong match.
// Requires an active LinkedIn session; skipped automatically if not logged in.
const TOP_APPLICANT_URL = "https://www.linkedin.com/jobs/collections/top-applicant/";

function linkedInSearchUrls(preferences?: SearchPreferences): string[] {
    const preferredRoles = preferences?.targetRoles?.filter(Boolean) ?? [];
    const preferredLocations = preferences?.targetLocations?.filter(Boolean) ?? [];
    const timeFilter = linkedInTimeFilter(preferences);

    let baseUrls: string[];

    if (preferredRoles.length > 0 || preferredLocations.length > 0) {
        const roles = preferredRoles.length ? preferredRoles : DEFAULT_SEARCH_KEYWORD_QUERIES;
        const locations = preferredLocations.length ? preferredLocations : [getSearchLocation()];
        const maxUrls = toPositiveInt(process.env.LINKEDIN_MAX_SEARCH_URLS, 8);
        const urls: string[] = [];

        for (const role of roles) {
            for (const location of locations) {
                const url = new URL("https://www.linkedin.com/jobs/search/");
                url.searchParams.set("keywords", role);
                if (/^\d+$/.test(location)) url.searchParams.set("geoId", location);
                else url.searchParams.set("location", location);
                url.searchParams.set("distance", DISTANCE);
                url.searchParams.set("f_TPR", timeFilter);
                urls.push(url.toString());
                if (urls.length >= maxUrls) break;
            }
            if (urls.length >= maxUrls) break;
        }

        baseUrls = urls;
    } else {
        const configured = process.env.LINKEDIN_SEARCH_URLS ?? process.env.LINKEDIN_SEARCH_URL;
        if (configured) {
            const urls = configured
                .split(/[\n,]/)
                .map((u) => u.trim())
                .filter(Boolean)
                .filter((u) => {
                    try {
                        const parsed = new URL(u);
                        return parsed.searchParams.has("keywords") ||
                            parsed.searchParams.has("geoId") ||
                            parsed.pathname.includes("/collections/");
                    } catch { return false; }
                })
                // Remove top-applicant from configured list — it's prepended below.
                .filter((u) => !u.includes("/collections/top-applicant"));
            if (urls.length > 0) {
                baseUrls = urls;
            } else {
                console.warn("[LinkedIn] Ignoring LINKEDIN_SEARCH_URL(S): missing keywords/geoId params or /collections/ path");
                baseUrls = DEFAULT_LINKEDIN_SEARCH_URLS;
            }
        } else if (process.env.LINKEDIN_USE_KEYWORD_QUERIES === "true") {
            const location = encodeURIComponent(getSearchLocation());
            baseUrls = DEFAULT_SEARCH_KEYWORD_QUERIES.map((query) => {
                const keywords = encodeURIComponent(query);
                return `https://www.linkedin.com/jobs/search/?keywords=${keywords}&location=${location}&f_TPR=${timeFilter}`;
            });
        } else {
            baseUrls = DEFAULT_LINKEDIN_SEARCH_URLS;
        }
    }

    // Always put top-applicant first — personalised recommendations are highest signal.
    return [TOP_APPLICANT_URL, ...baseUrls];
}

function isCollectionUrl(searchUrl: string): boolean {
    try { return new URL(searchUrl).pathname.includes("/collections/"); }
    catch { return false; }
}

function withStartParam(searchUrl: string, start: number): string {
    const url = new URL(searchUrl);
    if (isCollectionUrl(searchUrl)) {
        // Collections don't use f_TPR (time filter) but DO support start= for pagination.
        if (start > 0) url.searchParams.set("start", String(start));
        else url.searchParams.delete("start");
        return url.toString();
    }
    if (!url.searchParams.has("f_TPR")) url.searchParams.set("f_TPR", LINKEDIN_TIME_FILTER);
    if (start > 0) url.searchParams.set("start", String(start));
    else url.searchParams.delete("start");
    return url.toString();
}

/**
 * URL для открытия деталей вакансии в правой панели LinkedIn.
 * Используем currentJobId вместо навигации на /jobs/view/:id —
 * это быстрее и стабильнее, описание загружается без полного перехода.
 */
function buildDetailUrl(searchUrl: string, jobId: string): string {
    const url = new URL(searchUrl);
    if (!url.searchParams.has("f_TPR")) url.searchParams.set("f_TPR", LINKEDIN_TIME_FILTER);
    url.searchParams.set("currentJobId", jobId);
    return url.toString();
}

function normalizeLinkedInUrl(jobId: string): string {
    return `https://www.linkedin.com/jobs/view/${jobId}/`;
}

function shouldFetchLinkedInDetails(card: LinkedInJobCard): boolean {
    const title = card.title.trim();
    if (!title || title === "Unknown title") return true;
    return LINKEDIN_PREFILTER_TITLE_PATTERNS.some((p) => p.test(title));
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(): Promise<void> {
    return sleep(DETAIL_THROTTLE_MS + Math.random() * DETAIL_JITTER_MAX_MS);
}

function fallbackDescription(card: LinkedInJobCard): string {
    return [card.title, card.company, card.location].filter(Boolean).join(" ");
}

function decodeHtml(value: string): string {
    return value
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, "\"");
}

function htmlToText(value: string): string {
    return decodeHtml(value)
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function textBetween(html: string, pattern: RegExp): string | undefined {
    const text = htmlToText(pattern.exec(html)?.[1] ?? "");
    return text || undefined;
}

function guestSearchUrl(searchUrl: string, start: number): string {
    const input = new URL(withStartParam(searchUrl, start));
    const output = new URL("https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search");
    for (const key of ["keywords", "geoId", "location", "f_TPR", "distance", "start"]) {
        const value = input.searchParams.get(key);
        if (value) output.searchParams.set(key, value);
    }
    if (!output.searchParams.has("start")) output.searchParams.set("start", String(start));
    if (!output.searchParams.has("f_TPR")) output.searchParams.set("f_TPR", LINKEDIN_TIME_FILTER);
    return output.toString();
}

async function fetchLinkedInHtml(url: string): Promise<string> {
    const response = await fetch(url, {
        headers: {
            "user-agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
                "(KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
        },
    });
    if (!response.ok) throw new Error(`LinkedIn guest request failed: ${response.status}`);
    return response.text();
}

// ─── EXTRACT JOB IDs SCRIPT ───────────────────────────────────────────────────
//
// Читаем job IDs из нескольких вариантов LinkedIn DOM.
// LinkedIn часто меняет список между query/layout, поэтому data-occludable-job-id
// недостаточно: дополнительно берём IDs из href/currentJobId/data-entity-urn.
// Передаём как строку чтобы esbuild не добавил __name() → ReferenceError.

const EXTRACT_JOB_IDS_SCRIPT = /* javascript */ `
function extractJobIds(maxCards) {
    var seen = new Set();
    var ids = [];

    function add(jobId) {
        if (jobId && !seen.has(jobId)) {
            seen.add(jobId);
            ids.push(jobId);
        }
    }

    var items = Array.from(document.querySelectorAll([
        "li.scaffold-layout__list-item",
        "li[data-occludable-job-id]",
        "[data-job-id]",
        "[data-entity-urn*='urn:li:jobPosting:']",
        "a[href*='/jobs/view/']",
        "a[href*='currentJobId=']"
    ].join(",")));

    for (var i = 0; i < items.length && ids.length < maxCards; i++) {
        var item = items[i];
        add(item.getAttribute("data-occludable-job-id"));
        add(item.getAttribute("data-job-id"));

        var urn = item.getAttribute("data-entity-urn") || "";
        var urnMatch = urn.match(/urn:li:jobPosting:(\\d+)/);
        if (urnMatch) add(urnMatch[1]);

        var links = item.matches("a") ? [item] : Array.from(item.querySelectorAll("a[href*='/jobs/view/'],a[href*='currentJobId=']"));
        for (var j = 0; j < links.length && ids.length < maxCards; j++) {
            var href = links[j].getAttribute("href") || "";
            var viewMatch = href.match(/\\/jobs\\/view\\/(\\d+)/);
            if (viewMatch) add(viewMatch[1]);

            var currentMatch = href.match(/[?&]currentJobId=(\\d+)/);
            if (currentMatch) add(currentMatch[1]);
        }
    }

    return ids;
}
`;

// ─── EXTRACT CARD META SCRIPT ─────────────────────────────────────────────────
//
// После того как LinkedIn открыл правую панель с currentJobId,
// читаем title/company/location из самого <li> по jobId.

const EXTRACT_CARD_META_SCRIPT = /* javascript */ `
function extractCardMeta(jobId) {
    var li = document.querySelector(
        "li.scaffold-layout__list-item[data-occludable-job-id='" + jobId + "']"
    );

    if (!li) return null;

    function text(el, selector) {
        var found = el.querySelector(selector);
        return found ? (found.textContent || "").replace(/\\s+/g, " ").trim() || undefined : undefined;
    }

    var title =
        text(li, ".job-card-list__title--link") ||
        text(li, ".job-card-list__title") ||
        text(li, "[class*='job-card-list__title']") ||
        text(li, ".artdeco-entity-lockup__title") ||
        (() => {
            var a = li.querySelector("a[aria-label]");
            return a ? (a.getAttribute("aria-label") || "").trim() || undefined : undefined;
        })() ||
        "Unknown title";

    var company =
        text(li, ".job-card-container__primary-description") ||
        text(li, ".artdeco-entity-lockup__subtitle") ||
        text(li, ".job-card-container__company-name");

    var location =
        text(li, ".job-card-container__metadata-item") ||
        text(li, ".artdeco-entity-lockup__caption") ||
        text(li, ".job-card-list__location");

    var timeEl = li.querySelector("time");
    var postedAt = timeEl
        ? (timeEl.getAttribute("datetime") || timeEl.textContent || "").trim() || undefined
        : undefined;

    return { title: title, company: company, location: location, postedAt: postedAt };
}
`;

// ─── EXTRACT DESCRIPTION SCRIPT ───────────────────────────────────────────────

const EXTRACT_DESCRIPTION_SCRIPT = /* javascript */ `
function extractDescription(minLen) {
    var SELECTORS = [
        ".jobs-description__content",
        ".jobs-box__html-content",
        ".jobs-description-content__text",
        ".show-more-less-html__markup",
        ".description__text"
    ];

    for (var i = 0; i < SELECTORS.length; i++) {
        var el = document.querySelector(SELECTORS[i]);
        if (el) {
            var t = (el.textContent || "").replace(/\\s+/g, " ").trim();
            if (t.length > minLen) return t;
        }
    }

    return null;
}
`;

// ─── EVALUATE HELPERS ─────────────────────────────────────────────────────────

async function evalExtractJobIds(page: Page, maxCards: number): Promise<string[]> {
    return page.evaluate(
        ([script, max]) => {
            // eslint-disable-next-line no-new-func
            return new Function(`${script}; return extractJobIds;`)()(max) as string[];
        },
        [EXTRACT_JOB_IDS_SCRIPT, maxCards] as const,
    );
}

async function evalExtractCardMeta(
    page: Page,
    jobId: string,
): Promise<{ title: string; company?: string; location?: string; postedAt?: string } | null> {
    return page.evaluate(
        ([script, id]) => {
            // eslint-disable-next-line no-new-func
            return new Function(`${script}; return extractCardMeta;`)()(id) as ReturnType<
                typeof evalExtractCardMeta extends (...args: any[]) => Promise<infer R> ? () => R : never
            >;
        },
        [EXTRACT_CARD_META_SCRIPT, jobId] as const,
    );
}

async function evalExtractDescription(page: Page): Promise<string | null> {
    return page.evaluate(
        ([script, minLen]) => {
            // eslint-disable-next-line no-new-func
            return new Function(`${script}; return extractDescription;`)()(minLen) as string | null;
        },
        [EXTRACT_DESCRIPTION_SCRIPT, DESCRIPTION_MIN_LENGTH] as const,
    );
}

// ─── PAGE HELPERS ─────────────────────────────────────────────────────────────

async function closeLinkedInModals(page: Page): Promise<void> {
    for (const selector of MODAL_DISMISS_SELECTORS) {
        await page.locator(selector).first().click({ timeout: 400 }).catch(() => null);
    }
    await page.keyboard.press("Escape").catch(() => null);
}

/**
 * Ждёт появления описания вакансии в правой панели.
 * Описание подгружается асинхронно после смены currentJobId.
 */
async function waitForPanelDescription(page: Page, timeoutMs: number): Promise<string | null> {
    const selector = DESCRIPTION_SELECTORS.join(", ");

    await page.waitForFunction(
        ([sel, minLen]: [string, number]) => {
            const el = document.querySelector(sel);
            return (el?.textContent ?? "").trim().length > minLen;
        },
        [selector, DESCRIPTION_MIN_LENGTH] as [string, number],
        { timeout: timeoutMs },
    ).catch(() => null);

    return evalExtractDescription(page);
}

// ─── PROVIDER ─────────────────────────────────────────────────────────────────

export class LinkedInProvider implements JobProvider {
    source = "LINKEDIN";

    constructor(private readonly options: { storageStatePath?: string | null; preferences?: SearchPreferences } = {}) {}

    async search(): Promise<ParsedJob[]> {
        const storageStatePath = this.options.storageStatePath
            ? resolveLinkedInStorageStatePath(this.options.storageStatePath)
            : LINKEDIN_STORAGE_STATE_PATH;

        // Загружаем уже обработанные jobId из БД — не будем снова тратить запросы на них
        const existingJobIds = await this.loadExistingJobIds();

        const userDataDir = path.join(process.cwd(), "storage", "linkedin_profile");
        let browser: Browser | null = null;
        let context: BrowserContext | null = null;

        try {
            const contextOptions = {
                userAgent:
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
                    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                viewport: { width: 1440, height: 900 },
                ignoreHTTPSErrors: true,
            } as const;

            if (this.options.storageStatePath && fs.existsSync(storageStatePath)) {
                console.log(`[LinkedIn] Using saved user session: ${this.options.storageStatePath}`);
                browser = await chromium.launch({
                    headless: LINKEDIN_HEADLESS,
                    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
                });
                context = await browser.newContext({
                    ...contextOptions,
                    storageState: storageStatePath,
                });
            } else {
                context = await chromium.launchPersistentContext(userDataDir, {
                    headless: LINKEDIN_HEADLESS,
                    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
                    ...contextOptions,
                });
            }

            // Блокируем картинки, шрифты, медиа и трекеры — ускоряем загрузку
            await context.route("**/*", (route) => {
                const type = route.request().resourceType();
                const url  = route.request().url();
                if (
                    type === "image" || type === "font" || type === "media" ||
                    url.includes("analytics") || url.includes("tracking") ||
                    url.includes("ads") || url.includes("doubleclick") ||
                    url.includes("google-analytics") || url.includes("facebook.com/tr")
                ) {
                    return route.abort();
                }
                return route.continue();
            });

            let cards = await this.collectJobIds(context, existingJobIds);
            if (cards.length === 0) {
                console.log("[LinkedIn] Browser search returned 0 cards; falling back to guest jobs API");
                cards = await this.collectGuestJobCards(existingJobIds);
            }
            const filtered = cards.filter(shouldFetchLinkedInDetails);

            console.log(`[LinkedIn] Prefiltered ${filtered.length}/${cards.length} cards by title`);

            updateAutomationProgress({
                stage: "Collecting",
                message: `LinkedIn: ${filtered.length}/${cards.length} cards match title filter.`,
                currentTarget: "LinkedIn title prefilter",
                providerStatus: {
                    source: "LINKEDIN",
                    phase: "Title prefilter",
                    totalCards: cards.length,
                    prefilteredCards: filtered.length,
                    detailTotal: filtered.length,
                },
            });

            const jobs = await this.fetchDetails(context, filtered);
            return filterRelevantJobs(jobs);

        } finally {
            await context?.close();
            await browser?.close();
        }
    }

    private async collectGuestJobCardsForSearchUrl(
        baseSearchUrl: string,
        existingJobIds: Set<string>,
        seenJobIds: Set<string>,
    ): Promise<LinkedInJobCard[]> {
        const cards: LinkedInJobCard[] = [];

        console.log(`[LinkedIn] Guest scanning: ${guestSearchUrl(baseSearchUrl, 0)}`);
        for (let pageIndex = 0; pageIndex < LINKEDIN_MAX_PAGES; pageIndex++) {
            const start = pageIndex * LINKEDIN_PAGE_SIZE;
            const url = guestSearchUrl(baseSearchUrl, start);
            const html = await fetchLinkedInHtml(url).catch((error) => {
                console.error(`[LinkedIn] Guest search failed for ${url}:`, error);
                return "";
            });
            const matches = Array.from(html.matchAll(/<div class="base-card[\s\S]*?data-entity-urn="urn:li:jobPosting:(\d+)"[\s\S]*?<\/li>/gi));
            let newOnPage = 0;

            for (const match of matches.slice(0, LINKEDIN_MAX_CARDS_PER_PAGE)) {
                const jobId = match[1];
                if (seenJobIds.has(jobId) || existingJobIds.has(jobId)) continue;

                const cardHtml = match[0];
                seenJobIds.add(jobId);
                newOnPage++;
                cards.push({
                    title: textBetween(cardHtml, /base-search-card__title[^>]*>([\s\S]*?)<\/h3>/i) ?? "Unknown title",
                    company: textBetween(cardHtml, /base-search-card__subtitle[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i),
                    location: textBetween(cardHtml, /job-search-card__location[^>]*>([\s\S]*?)<\/span>/i),
                    postedAt: /<time[^>]*datetime="([^"]+)"/i.exec(cardHtml)?.[1],
                    url: normalizeLinkedInUrl(jobId),
                    jobId,
                    searchUrl: baseSearchUrl,
                });
            }

            console.log(`[LinkedIn] guest start=${start}: found=${matches.length}, new=${newOnPage}, total=${cards.length}`);
            if (newOnPage === 0) break;
        }

        return cards;
    }

    private async collectGuestJobCards(existingJobIds: Set<string>): Promise<LinkedInJobCard[]> {
        const cards: LinkedInJobCard[] = [];
        const seenJobIds = new Set<string>();

        for (const baseSearchUrl of linkedInSearchUrls(this.options.preferences)) {
            cards.push(...await this.collectGuestJobCardsForSearchUrl(baseSearchUrl, existingJobIds, seenJobIds));
        }

        return cards;
    }

    // ── 1. Загрузка известных jobId из БД ───────────────────────────────────

    private async loadExistingJobIds(): Promise<Set<string>> {
        const existing = await prisma.job.findMany({
            where: {
                externalJobId: { not: null },
                OR: [
                    { source: "LINKEDIN" },
                    { source: "STORAGE_IMPORT", externalJobId: { not: null } },
                ],
            },
            select: { externalJobId: true },
        });
        const ids = new Set(
            existing
                .map((j) => j.externalJobId)
                .filter((id): id is string => typeof id === "string" && /^\d+$/.test(id)),
        );
        console.log(`[LinkedIn] Loaded ${ids.size} existing LinkedIn job IDs from DB`);
        return ids;
    }

    private async readSearchPageJobIds(page: Page, searchUrl: string, start: number): Promise<string[]> {
        for (let attempt = 0; attempt <= LINKEDIN_EMPTY_PAGE_RETRIES; attempt++) {
            await page
                .waitForSelector(
                    JOB_CARD_SELECTOR,
                    { timeout: WAIT_FOR_LIST_TIMEOUT_MS },
                )
                .catch(() => null);

            const jobIds = await evalExtractJobIds(page, LINKEDIN_MAX_CARDS_PER_PAGE);
            if (jobIds.length > 0 || attempt >= LINKEDIN_EMPTY_PAGE_RETRIES) return jobIds;

            console.warn(
                `[LinkedIn] start=${start}: no cards after attempt ${attempt + 1}; retrying search page load...`,
            );
            await sleep(WAIT_AFTER_EMPTY_PAGE_MS);
            await page.reload({ waitUntil: "domcontentloaded", timeout: LINKEDIN_SEARCH_TIMEOUT_MS }).catch(async () => {
                await page.goto(searchUrl, {
                    waitUntil: "domcontentloaded",
                    timeout: LINKEDIN_SEARCH_TIMEOUT_MS,
                });
            });
            await sleep(WAIT_AFTER_GOTO_MS);
            await closeLinkedInModals(page);
        }

        return [];
    }

    // ── 2. Сбор jobId из списка (без скролла) ────────────────────────────────

    private async collectJobIds(
        context: BrowserContext,
        existingJobIds: Set<string>,
    ): Promise<LinkedInJobCard[]> {
        const page = await context.newPage();
        const cards: LinkedInJobCard[] = [];
        const seenJobIds = new Set<string>();

        try {
            for (const baseSearchUrl of linkedInSearchUrls(this.options.preferences)) {
                let emptyPages = 0;
                console.log(`[LinkedIn] Scanning: ${baseSearchUrl}`);

                updateAutomationProgress({
                    stage: "Collecting",
                    message: "LinkedIn: scanning search results...",
                    currentTarget: "LinkedIn search results",
                    providerStatus: {
                        source: "LINKEDIN",
                        phase: "Scanning pages",
                        searchUrl: baseSearchUrl,
                        totalCards: cards.length,
                    },
                });

                // Collections support start= pagination like regular search pages.
                const maxPages = LINKEDIN_MAX_PAGES;
                for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
                    const start = pageIndex * LINKEDIN_PAGE_SIZE;
                    const searchUrl = withStartParam(baseSearchUrl, start);

                    try {
                        await page.goto(searchUrl, {
                            waitUntil: "domcontentloaded",
                            timeout: LINKEDIN_SEARCH_TIMEOUT_MS,
                        });
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        console.warn(`[LinkedIn] Search page failed at start=${start}; keeping ${cards.length} collected cards: ${message}`);
                        updateAutomationProgress({
                            stage: "Collecting",
                            message: `LinkedIn: search page start=${start} failed; keeping ${cards.length} cards.`,
                            currentTarget: `LinkedIn page start=${start}`,
                            providerStatus: {
                                source: "LINKEDIN",
                                phase: "Scanning pages",
                                searchUrl,
                                pageStart: start,
                                totalCards: cards.length,
                            },
                        });
                        break;
                    }

                    await sleep(WAIT_AFTER_GOTO_MS);
                    await closeLinkedInModals(page);

                    // Читаем job IDs прямо из data-атрибутов списка — никакого скролла
                    const jobIds = await this.readSearchPageJobIds(page, searchUrl, start);

                    let newOnPage = 0;

                    for (const jobId of jobIds) {
                        if (seenJobIds.has(jobId)) continue;
                        if (existingJobIds.has(jobId)) continue; // уже в БД — пропускаем

                        seenJobIds.add(jobId);
                        newOnPage++;

                        // Читаем мета-данные из <li> сразу (без дополнительного запроса)
                        const meta = await evalExtractCardMeta(page, jobId).catch(() => null);

                        cards.push({
                            title: meta?.title ?? "Unknown title",
                            company: meta?.company,
                            location: meta?.location,
                            postedAt: meta?.postedAt,
                            url: normalizeLinkedInUrl(jobId),
                            jobId,
                            searchUrl: baseSearchUrl, // сохраняем базовый URL для buildDetailUrl
                        });
                    }

                    console.log(
                        `[LinkedIn] start=${start}: found=${jobIds.length}, new=${newOnPage}, total=${cards.length}`,
                    );

                    updateAutomationProgress({
                        stage: "Collecting",
                        message: `LinkedIn: start=${start}, ${newOnPage} new / ${jobIds.length} in list.`,
                        currentTarget: `LinkedIn page start=${start}`,
                        providerStatus: {
                            source: "LINKEDIN",
                            phase: "Scanning pages",
                            searchUrl,
                            pageStart: start,
                            visibleCards: jobIds.length,
                            newCards: newOnPage,
                            totalCards: cards.length,
                        },
                    });

                    if (jobIds.length === 0 && start === 0) {
                        console.warn(`[LinkedIn] Browser search returned 0 cards for this query; trying guest fallback.`);
                        const guestCards = await this.collectGuestJobCardsForSearchUrl(baseSearchUrl, existingJobIds, seenJobIds);
                        if (guestCards.length > 0) {
                            cards.push(...guestCards);
                            console.log(`[LinkedIn] Guest fallback added ${guestCards.length} cards, total=${cards.length}`);
                            emptyPages = 0;
                            break;
                        }
                    }

                    if (newOnPage === 0) {
                        emptyPages++;
                        if (emptyPages >= LINKEDIN_EMPTY_PAGE_STOP) {
                            console.log(`[LinkedIn] Stopping after ${emptyPages} empty pages`);
                            break;
                        }
                    } else {
                        emptyPages = 0;
                    }
                }
            }
        } finally {
            await page.close();
        }

        return cards;
    }

    // ── 3. Получение описаний через currentJobId ─────────────────────────────
    //
    // Открываем searchUrl?currentJobId=XXX — LinkedIn подгружает описание
    // в правую панель без полной навигации на /jobs/view/:id.
    // Одна переиспользуемая страница, последовательно для каждой карточки.

    private async fetchDetails(
        context: BrowserContext,
        cards: LinkedInJobCard[],
    ): Promise<ParsedJob[]> {
        if (cards.length === 0) return [];

        if (!shouldFetchProviderDetails()) {
            return cards.map((card) => ({
                title: card.title,
                company: card.company,
                location: card.location,
                url: card.url,
                externalJobId: card.jobId,
                postedAt: card.postedAt ? new Date(card.postedAt) : undefined,
                source: "LINKEDIN",
                description: cardDescription(card),
            }));
        }

        const jobs: ParsedJob[] = [];
        const page = await context.newPage();

        // Текущий searchUrl загруженный на странице (не перезагружаем если совпадает)
        let currentBaseUrl: string | null = null;

        try {
            for (let i = 0; i < cards.length; i++) {
                const card = cards[i];
                if (!card.jobId) continue;

                const isLoggable = i === 0 || (i + 1) % 5 === 0 || i === cards.length - 1;

                if (isLoggable) {
                    console.log(
                        `[LinkedIn] Details ${i + 1}/${cards.length}: ${card.title} @ ${card.company ?? "Unknown"}`,
                    );
                    updateAutomationProgress({
                        stage: "Collecting",
                        message: `LinkedIn: details ${i + 1}/${cards.length}.`,
                        currentTarget: `${card.title} @ ${card.company ?? "Unknown"}`,
                        providerStatus: {
                            source: "LINKEDIN",
                            phase: "Fetching descriptions",
                            totalCards: cards.length,
                            detailIndex: i + 1,
                            detailTotal: cards.length,
                            detailTitle: `${card.title} @ ${card.company ?? "Unknown"}`,
                        },
                    });
                }

                try {
                    const guestJob = await this.fetchGuestJobDetail(card).catch(() => null);
                    if (guestJob) {
                        jobs.push(guestJob);
                        if (i < cards.length - 1) await jitter();
                        continue;
                    }

                    const detailUrl = buildDetailUrl(card.searchUrl, card.jobId);

                    // Если базовый searchUrl совпадает с уже загруженным —
                    // меняем только currentJobId через goto (быстрее полного reload)
                    if (currentBaseUrl !== card.searchUrl) {
                        await page.goto(detailUrl, {
                            waitUntil: "domcontentloaded",
                            timeout: LINKEDIN_DETAIL_TIMEOUT_MS,
                        });
                        currentBaseUrl = card.searchUrl;
                    } else {
                        // Уже на нужном searchUrl — просто меняем currentJobId через pushState
                        await page.goto(detailUrl, {
                            waitUntil: "commit",
                            timeout: LINKEDIN_DETAIL_TIMEOUT_MS,
                        });
                    }

                    await closeLinkedInModals(page);

                    const description =
                        (await waitForPanelDescription(page, LINKEDIN_DETAIL_TIMEOUT_MS)) ??
                        fallbackDescription(card);

                    // Если title не удалось получить из списка — пробуем из правой панели
                    let title = card.title;
                    if (!title || title === "Unknown title") {
                        title = await page
                            .locator(".job-details-jobs-unified-top-card__job-title, h1")
                            .first()
                            .textContent()
                            .then((t) => t?.trim() || "Unknown title")
                            .catch(() => "Unknown title");
                    }

                    // Аналогично для company
                    let company = card.company;
                    if (!company) {
                        company = await page
                            .locator(
                                ".job-details-jobs-unified-top-card__company-name, " +
                                "[data-anonymize='company-name']",
                            )
                            .first()
                            .textContent()
                            .then((t) => t?.trim() || undefined)
                            .catch(() => undefined);
                    }

                    const postedAt =
                        card.postedAt
                            ? new Date(card.postedAt)
                            : await page
                                .locator("time")
                                .first()
                                .getAttribute("datetime")
                                .then((v) => (v ? new Date(v) : undefined))
                                .catch(() => undefined);

                    jobs.push({
                        title,
                        company,
                        location: card.location,
                        url: card.url,
                        externalJobId: card.jobId,
                        postedAt,
                        source: "LINKEDIN",
                        // Ограничиваем длину описания — 5000 символов достаточно для анализа
                        description: description.slice(0, 5_000),
                    });

                } catch (error) {
                    console.error(`[LinkedIn] Failed details for jobId=${card.jobId}:`, error);
                    jobs.push({
                        title: card.title,
                        company: card.company,
                        location: card.location,
                        url: card.url,
                        externalJobId: card.jobId,
                        postedAt: card.postedAt ? new Date(card.postedAt) : undefined,
                        source: "LINKEDIN",
                        description: fallbackDescription(card),
                    });
                }

                // Throttle + случайный jitter — снижает риск блокировки
                if (i < cards.length - 1) {
                    await jitter();
                }
            }
        } finally {
            await page.close();
        }

        return jobs;
    }

    private async fetchGuestJobDetail(card: LinkedInJobCard): Promise<ParsedJob | null> {
        if (!card.jobId || !shouldFetchProviderDetails()) return null;

        const html = await fetchLinkedInHtml(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${card.jobId}`);
        const description = textBetween(html, /<div[^>]*class="[^"]*show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        if (!description || description.length < 120) return null;

        return {
            title: textBetween(html, /<h2[^>]*topcard__title[^>]*>([\s\S]*?)<\/h2>/i) ?? card.title,
            company: textBetween(html, /topcard__org-name-link[^>]*>([\s\S]*?)<\/a>/i) ?? card.company,
            location: textBetween(html, /topcard__flavor topcard__flavor--bullet[^>]*>([\s\S]*?)<\/span>/i) ?? card.location,
            url: card.url,
            externalJobId: card.jobId,
            postedAt: card.postedAt ? new Date(card.postedAt) : undefined,
            source: "LINKEDIN",
            description: description.slice(0, 5_000),
        };
    }
}
