import fs from "fs";
import path from "path";
import { Browser, BrowserContext, BrowserContextOptions, Page, chromium } from "playwright";
import { ParsedJob } from "./types";

export const DEFAULT_SEARCH_KEYWORDS = process.env.JOB_SEARCH_KEYWORDS ?? "Node.js TypeScript AWS Backend";
export const DEFAULT_SEARCH_LOCATION = process.env.JOB_SEARCH_LOCATION ?? "Israel";
export const DEFAULT_SEARCH_KEYWORD_QUERIES = (
    process.env.JOB_SEARCH_KEYWORDS ??
    "full stack developer,backend developer,node.js typescript,react node.js aws"
)
    .split(/[\n,]/)
    .map((query) => query.trim())
    .filter(Boolean);

let searchLocationOverride: string | undefined;

export function setSearchLocationOverride(value?: string | null) {
    searchLocationOverride = value?.trim() || undefined;
}

export function getSearchLocation(): string {
    return searchLocationOverride ?? DEFAULT_SEARCH_LOCATION;
}

export function shouldFetchProviderDetails(): boolean {
    return process.env.PROVIDER_FETCH_DETAILS === "true";
}

export function cardDescription(card: {
    title: string;
    company?: string;
    location?: string;
}): string {
    return [card.title, card.company, card.location]
        .filter(Boolean)
        .join(" | ");
}

const RELEVANT_JOB_PATTERNS = [
    /full[\s-]?stack/i,
    /back[\s-]?end/i,
    /backend/i,
    /front[\s-]?end/i,
    /frontend/i,
    /node(?:\.js)?/i,
    /typescript/i,
    /javascript/i,
    /react/i,
    /next(?:\.js)?/i,
    /express(?:\.js)?/i,
    /aws/i,
    /software engineer/i,
    /software developer/i,
    /web developer/i,
];

const NON_JOB_URL_PATTERNS = [
    /\/article/i,
    /ArticlePage/i,
    /UserList/i,
    /Mador/i,
    /\/blog/i,
    /\/category/i,
    /\/categories/i,
    /\/companies/i,
    /\/company/i,
    /\/salary/i,
    /\/salaries/i,
    /\/interview/i,
    /\/benefits/i,
    /\/community/i,
];

const NON_JOB_TITLE_PATTERNS = [
    /^jobs?$/i,
    /^היום$/,
    /דיווח על תוכן/i,
    /כתבה/i,
    /מאמר/i,
    /שכר/i,
    /חברות השמה/i,
    /יחידות טכנולוגיות/i,
    /עריכה\/ניהול אתר/i,
    /הצטרפו לאחת המשרות/i,
];

export function cleanJobTitle(title?: string | null): string {
    return (title ?? "")
        .replace(/\s+/g, " ")
        .trim();
}

export function isRelevantJobText(value: string): boolean {
    return RELEVANT_JOB_PATTERNS.some((pattern) => pattern.test(value));
}

export function isLikelyJobUrl(url?: string | null): boolean {
    if (!url) return false;
    if (/^(javascript|mailto|tel|sms|data|blob):/i.test(url.trim())) return false;

    try {
        const parsed = new URL(url);
        if (!["http:", "https:"].includes(parsed.protocol)) return false;
        if (!parsed.hostname) return false;
    } catch {
        return false;
    }

    if (NON_JOB_URL_PATTERNS.some((pattern) => pattern.test(url))) return false;

    return true;
}

export function isLikelyRelevantJob(job: Pick<ParsedJob, "title" | "company" | "location" | "url" | "description">): boolean {
    const title = cleanJobTitle(job.title);

    if (!title || title.length < 3) return false;
    if (NON_JOB_TITLE_PATTERNS.some((pattern) => pattern.test(title))) return false;
    if (!isLikelyJobUrl(job.url)) return false;

    const haystack = [
        title,
        job.company ?? "",
        job.location ?? "",
        job.description ?? "",
    ].join(" ");

    return isRelevantJobText(haystack);
}

export function filterRelevantJobs<T extends ParsedJob>(jobs: T[]): T[] {
    const seen = new Set<string>();
    const filtered: T[] = [];

    for (const job of jobs) {
        if (!isLikelyRelevantJob(job)) continue;

        const key = job.url ?? `${job.title}|${job.company ?? ""}|${job.location ?? ""}`;
        if (seen.has(key)) continue;

        seen.add(key);
        filtered.push({
            ...job,
            title: cleanJobTitle(job.title),
        });
    }

    return filtered;
}

const USER_AGENT =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

export function getGlassdoorStorageStatePath(): string {
    return process.env.GLASSDOOR_STORAGE_STATE ?? path.join(process.cwd(), "storage", "glassdoor-storage-state.json");
}

export function hasGlassdoorStorageState(): boolean {
    return fs.existsSync(getGlassdoorStorageStatePath());
}

export async function createProviderBrowser(options: {
    timeoutMs?: number;
} = {}): Promise<Browser> {
    const browser = await chromium.launch({
        headless: process.env.PROVIDER_HEADLESS !== "false",
    });
    const envTimeoutMs = Number(process.env.PROVIDER_BROWSER_TIMEOUT_MS ?? 120000);
    const timeoutMs = options.timeoutMs ?? envTimeoutMs;

    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        const timer = setTimeout(() => {
            browser.close().catch(() => undefined);
        }, timeoutMs);

        timer.unref?.();
        browser.on("disconnected", () => clearTimeout(timer));
    }

    return browser;
}

export async function newProviderPage(browser: Browser): Promise<Page> {
    const page = await browser.newPage({
        userAgent: USER_AGENT,
        locale: "en-US",
    });

    const timeoutMs = Number(process.env.PROVIDER_PAGE_TIMEOUT_MS ?? 20000);

    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        page.setDefaultTimeout(timeoutMs);
        page.setDefaultNavigationTimeout(timeoutMs);
    }

    return page;
}

export async function newProviderContext(
    browser: Browser,
    options: BrowserContextOptions = {},
): Promise<BrowserContext> {
    return browser.newContext({
        userAgent: USER_AGENT,
        locale: "en-US",
        ...options,
    });
}

export function absoluteUrl(url: string | undefined, baseUrl: string): string | undefined {
    if (!url) return undefined;

    try {
        return new URL(url, baseUrl).toString();
    } catch {
        return undefined;
    }
}

export function parsePostedAt(value?: string | null): Date | undefined {
    if (!value) return undefined;

    const trimmed = value.trim();
    const direct = new Date(trimmed);

    if (!Number.isNaN(direct.getTime())) return direct;

    const lower = trimmed.toLowerCase();
    const now = new Date();
    const relative = /(\d+)\s*(minute|hour|day|week|month)s?\s*ago/.exec(lower);

    if (relative) {
        const amount = Number(relative[1]);
        const unit = relative[2];
        const date = new Date(now);

        if (unit === "minute") date.setMinutes(date.getMinutes() - amount);
        if (unit === "hour") date.setHours(date.getHours() - amount);
        if (unit === "day") date.setDate(date.getDate() - amount);
        if (unit === "week") date.setDate(date.getDate() - amount * 7);
        if (unit === "month") date.setMonth(date.getMonth() - amount);

        return date;
    }

    if (/today|just posted|new/.test(lower)) return now;

    if (/yesterday/.test(lower)) {
        const date = new Date(now);
        date.setDate(date.getDate() - 1);
        return date;
    }

    return undefined;
}

export async function extractDescription(page: Page, selectors: string[]): Promise<string | undefined> {
    for (const selector of selectors) {
        const text = await page
            .locator(selector)
            .first()
            .textContent({ timeout: 5000 })
            .catch(() => null);

        if (text?.trim() && text.trim().length >= 80) {
            return text.trim();
        }
    }

    const body = await page.locator("body").textContent({ timeout: 5000 }).catch(() => null);
    return body?.trim() || undefined;
}
