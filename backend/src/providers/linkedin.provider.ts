import fs from "fs";
import path from "path";
import { chromium } from "playwright";
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

const DEFAULT_LINKEDIN_SEARCH_URLS = [
    "https://www.linkedin.com/jobs/search/?currentJobId=4419299075&distance=25&f_TPR=r86400&geoId=101620260&keywords=Full%20Stack&origin=JOB_SEARCH_PAGE_JOB_FILTER&refresh=true",
    "https://www.linkedin.com/jobs/search/?distance=25&f_TPR=r86400&geoId=101620260&keywords=Backend%20Developer&origin=JOB_SEARCH_PAGE_JOB_FILTER&refresh=true",
];

const LINKEDIN_STORAGE_STATE_PATH = process.env.LINKEDIN_STORAGE_STATE ??
    path.join(process.cwd(), "storage", "linkedin_auth.json");
const LINKEDIN_PAGE_SIZE = Number(process.env.LINKEDIN_PAGE_SIZE ?? 25);
const LINKEDIN_MAX_PAGES = Number(process.env.LINKEDIN_MAX_PAGES ?? 100);
const LINKEDIN_DETAIL_TIMEOUT_MS = Number(process.env.LINKEDIN_DETAIL_TIMEOUT_MS ?? 15000);
const LINKEDIN_MAX_CARDS_PER_PAGE = Number(process.env.LINKEDIN_MAX_CARDS_PER_PAGE ?? 25);
const LINKEDIN_EMPTY_PAGE_STOP = Number(process.env.LINKEDIN_EMPTY_PAGE_STOP ?? 2);
const LINKEDIN_PREFILTER_TITLE_PATTERNS = [
    /full[\s-]?stack/i,
    /fullstack/i,
    /back[\s-]?end/i,
    /backend/i,
    /front[\s-]?end/i,
    /frontend/i,
];

type LinkedInJobCard = {
    title: string;
    company?: string;
    location?: string;
    url?: string;
    jobId?: string;
    searchUrl: string;
    postedAt?: string;
};

function linkedInSearchUrls(): string[] {
    const configured = process.env.LINKEDIN_SEARCH_URLS ?? process.env.LINKEDIN_SEARCH_URL;

    if (configured) {
        return configured
            .split(/[\n,]/)
            .map((url) => url.trim())
            .filter(Boolean);
    }

    if (process.env.LINKEDIN_USE_KEYWORD_QUERIES === "true") {
        const location = encodeURIComponent(getSearchLocation());

        return DEFAULT_SEARCH_KEYWORD_QUERIES.map((query) => {
            const keywords = encodeURIComponent(query);
            return `https://www.linkedin.com/jobs/search/?keywords=${keywords}&location=${location}`;
        });
    }

    return DEFAULT_LINKEDIN_SEARCH_URLS;
}

function withStartParam(searchUrl: string, start: number): string {
    const url = new URL(searchUrl);
    url.searchParams.set("f_TPR", "r86400");

    if (start > 0) {
        url.searchParams.set("start", String(start));
    } else {
        url.searchParams.delete("start");
    }

    return url.toString();
}

function buildLinkedInDetailSearchUrl(searchUrl: string, jobId?: string): string {
    const url = new URL(searchUrl);
    url.searchParams.set("f_TPR", "r86400");
    if (!jobId) return url.toString();

    url.searchParams.set("currentJobId", jobId);

    return url.toString();
}

function shouldFetchLinkedInDetails(card: LinkedInJobCard): boolean {
    const title = card.title.trim();

    return LINKEDIN_PREFILTER_TITLE_PATTERNS.some((pattern) => pattern.test(title));
}

function maxLinkedInPages(): number {
    return Number.isFinite(LINKEDIN_MAX_PAGES) && LINKEDIN_MAX_PAGES > 0
        ? LINKEDIN_MAX_PAGES
        : 100;
}

function linkedInPageSize(): number {
    return Number.isFinite(LINKEDIN_PAGE_SIZE) && LINKEDIN_PAGE_SIZE > 0
        ? LINKEDIN_PAGE_SIZE
        : 25;
}

function emptyPageStopCount(): number {
    return Number.isFinite(LINKEDIN_EMPTY_PAGE_STOP) && LINKEDIN_EMPTY_PAGE_STOP > 0
        ? LINKEDIN_EMPTY_PAGE_STOP
        : 2;
}

export class LinkedInProvider implements JobProvider {
    source = "LINKEDIN";

    constructor(private readonly options: { storageStatePath?: string | null } = {}) {}

    async search(): Promise<ParsedJob[]> {
        const storageStatePath = this.options.storageStatePath || LINKEDIN_STORAGE_STATE_PATH;
        const browser = await chromium.launch({
            headless: true,
        });

        const context = await browser.newContext({
            ...(fs.existsSync(storageStatePath)
                ? { storageState: storageStatePath }
                : {}),
            userAgent:
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
        });
        const page = await context.newPage();

        const jobCards: LinkedInJobCard[] = [];
        const seenCards = new Set<string>();

        const pageSize = linkedInPageSize();
        const maxPages = maxLinkedInPages();
        const stopAfterEmptyPages = emptyPageStopCount();

        for (const baseSearchUrl of linkedInSearchUrls()) {
            let emptyPages = 0;
            console.log(`[LinkedIn] Scanning search URL: ${baseSearchUrl}`);
            updateAutomationProgress({
                stage: "Collecting",
                message: "LinkedIn: scanning search results...",
                currentTarget: "LinkedIn search results",
                providerStatus: {
                    source: "LINKEDIN",
                    phase: "Scanning pages",
                    searchUrl: baseSearchUrl,
                    totalCards: jobCards.length,
                },
            });

            for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
                const searchUrl = withStartParam(baseSearchUrl, pageIndex * pageSize);
                const start = pageIndex * pageSize;

                await page.goto(searchUrl, {
                    waitUntil: "domcontentloaded",
                    timeout: 60000,
                });

                await page.waitForTimeout(3000);

                const extractCards = new Function(`return (maxCardsPerPage) => {
                const cards = Array.from(document.querySelectorAll(
                    ".base-card, .job-card-container, .jobs-search-results__list-item, .scaffold-layout__list-item, [data-job-id]",
                ));
                const visible = (element) => {
                    const box = element.getBoundingClientRect();

                    return box.width > 0 &&
                        box.height > 0 &&
                        box.bottom >= 0 &&
                        box.right >= 0 &&
                        box.top <= window.innerHeight &&
                        box.left <= window.innerWidth;
                };

                return cards
                    .filter(visible)
                    .slice(0, maxCardsPerPage)
                    .map((card) => {
                    const title =
                        card.querySelector(".job-card-list__title")?.textContent?.trim() ||
                        card.querySelector(".job-card-container__link")?.textContent?.trim() ||
                        card.querySelector("a[href*='/jobs/view/']")?.textContent?.trim() ||
                        card.querySelector(".base-search-card__title")?.textContent?.trim() ||
                        "Unknown title";

                    const company =
                        card.querySelector(".job-card-container__primary-description")?.textContent?.trim() ||
                        card.querySelector(".artdeco-entity-lockup__subtitle")?.textContent?.trim() ||
                        card.querySelector(".base-search-card__subtitle")?.textContent?.trim() ||
                        undefined;

                    const location =
                        card.querySelector(".job-card-container__metadata-item")?.textContent?.trim() ||
                        card.querySelector(".artdeco-entity-lockup__caption")?.textContent?.trim() ||
                        card.querySelector(".job-search-card__location")?.textContent?.trim() ||
                        undefined;

                    const url =
                        card.querySelector("a[href*='/jobs/view/']")
                            ?.href ||
                        card.querySelector("a.job-card-container__link")
                            ?.href ||
                        card.querySelector("a.base-card__full-link")
                            ?.href || undefined;
                    const jobId =
                        card.getAttribute("data-job-id") ||
                        card.getAttribute("data-occludable-job-id") ||
                        url?.match(new RegExp("/jobs/view/(\\\\d+)"))?.[1];
                    const normalizedUrl = jobId
                        ? "https://www.linkedin.com/jobs/view/" + jobId + "/"
                        : url;

                    const postedAt =
                        card.querySelector("time")?.getAttribute("datetime") ||
                        undefined;

                    return {
                        title,
                        company,
                        location,
                        url: normalizedUrl,
                        jobId,
                        postedAt,
                    };
                });
                }`)() as (maxCardsPerPage: number) => Array<{
                    title: string;
                    company?: string;
                    location?: string;
                    url?: string;
                    jobId?: string;
                    postedAt?: string;
                }>;
                const pageCards = await page.evaluate(extractCards, Number.isFinite(LINKEDIN_MAX_CARDS_PER_PAGE) && LINKEDIN_MAX_CARDS_PER_PAGE > 0
                    ? LINKEDIN_MAX_CARDS_PER_PAGE
                    : 25);
                let newCardsOnPage = 0;

                for (const card of pageCards) {
                    if (!card.url || seenCards.has(card.url)) continue;
                    seenCards.add(card.url);
                    newCardsOnPage++;
                    jobCards.push({
                        ...card,
                        searchUrl,
                    });
                }

                console.log(
                    `[LinkedIn] Page start=${start}: visible=${pageCards.length}, new=${newCardsOnPage}, total=${jobCards.length}`,
                );
                updateAutomationProgress({
                    stage: "Collecting",
                    message: `LinkedIn: page start=${start}, ${newCardsOnPage} new jobs from ${pageCards.length} visible cards.`,
                    currentTarget: `LinkedIn page start=${start}`,
                    providerStatus: {
                        source: "LINKEDIN",
                        phase: "Scanning pages",
                        searchUrl,
                        pageStart: start,
                        visibleCards: pageCards.length,
                        newCards: newCardsOnPage,
                        totalCards: jobCards.length,
                    },
                });

                if (newCardsOnPage === 0) {
                    emptyPages++;
                    if (emptyPages >= stopAfterEmptyPages) {
                        console.log(
                            `[LinkedIn] Stopping pagination after ${emptyPages} empty/repeated pages at start=${start}`,
                        );
                        break;
                    }
                } else {
                    emptyPages = 0;
                }
            }
        }

        const prefilteredJobCards = jobCards.filter(shouldFetchLinkedInDetails);
        console.log(
            `[LinkedIn] Prefiltered ${prefilteredJobCards.length}/${jobCards.length} cards for detail fetching`,
        );
        updateAutomationProgress({
            stage: "Collecting",
            message: `LinkedIn: ${prefilteredJobCards.length}/${jobCards.length} cards match Full Stack, Backend, or Frontend titles.`,
            currentTarget: "LinkedIn title prefilter",
            providerStatus: {
                source: "LINKEDIN",
                phase: "Title prefilter",
                totalCards: jobCards.length,
                prefilteredCards: prefilteredJobCards.length,
                detailTotal: prefilteredJobCards.length,
            },
        });
        const jobs: ParsedJob[] = [];

        for (let index = 0; index < prefilteredJobCards.length; index++) {
            const card = prefilteredJobCards[index];
            if (!card.url) continue;

            if (!shouldFetchProviderDetails()) {
                jobs.push({
                    title: card.title,
                    company: card.company,
                    location: card.location,
                    url: card.url,
                    postedAt: card.postedAt ? new Date(card.postedAt) : undefined,
                    source: "LINKEDIN",
                    description: cardDescription(card),
                });
                continue;
            }

            const detailPage = await context.newPage();

            try {
                if (index === 0 || (index + 1) % 5 === 0 || index === prefilteredJobCards.length - 1) {
                    console.log(
                        `[LinkedIn] Fetching details ${index + 1}/${prefilteredJobCards.length}: ${card.title} @ ${card.company ?? "Unknown"}`,
                    );
                    updateAutomationProgress({
                        stage: "Collecting",
                        message: `LinkedIn: fetching job details ${index + 1}/${prefilteredJobCards.length}.`,
                        currentTarget: `${card.title} @ ${card.company ?? "Unknown"}`,
                        providerStatus: {
                            source: "LINKEDIN",
                            phase: "Fetching descriptions",
                            totalCards: jobCards.length,
                            prefilteredCards: prefilteredJobCards.length,
                            detailIndex: index + 1,
                            detailTotal: prefilteredJobCards.length,
                            detailTitle: `${card.title} @ ${card.company ?? "Unknown"}`,
                        },
                    });
                }

                await detailPage.goto(buildLinkedInDetailSearchUrl(card.searchUrl, card.jobId), {
                    waitUntil: "commit",
                    timeout: Number.isFinite(LINKEDIN_DETAIL_TIMEOUT_MS) && LINKEDIN_DETAIL_TIMEOUT_MS > 0
                        ? LINKEDIN_DETAIL_TIMEOUT_MS
                        : 15000,
                });

                await detailPage.waitForFunction(() => {
                    const description = document.querySelector(
                        ".jobs-description__content, .jobs-box__html-content, .jobs-description-content__text, .show-more-less-html__markup, .description__text",
                    );

                    return (description?.textContent ?? "").trim().length > 300;
                }, undefined, {
                    timeout: Number.isFinite(LINKEDIN_DETAIL_TIMEOUT_MS) && LINKEDIN_DETAIL_TIMEOUT_MS > 0
                        ? LINKEDIN_DETAIL_TIMEOUT_MS
                        : 15000,
                }).catch(() => undefined);

                const fullDescription =
                    (await detailPage
                        .locator(".jobs-description__content")
                        .first()
                        .textContent()
                        .catch(() => null)) ||
                    (await detailPage
                        .locator(".jobs-box__html-content")
                        .first()
                        .textContent()
                        .catch(() => null)) ||
                    (await detailPage
                        .locator(".jobs-description-content__text")
                        .first()
                        .textContent()
                        .catch(() => null)) ||
                    (await detailPage
                        .locator(".show-more-less-html__markup")
                        .first()
                        .textContent()
                        .catch(() => null)) ||
                    (await detailPage
                        .locator(".description__text")
                        .first()
                        .textContent()
                        .catch(() => null)) ||
                    `${card.title} ${card.company ?? ""} ${card.location ?? ""}`;

                const postedAt =
                    card.postedAt
                        ? new Date(card.postedAt)
                        : await detailPage
                            .locator("time")
                            .first()
                            .getAttribute("datetime")
                            .then((value) => (value ? new Date(value) : undefined))
                            .catch(() => undefined);

                jobs.push({
                    title: card.title,
                    company: card.company,
                    location: card.location,
                    url: card.url,
                    postedAt,
                    source: "LINKEDIN",
                    description: fullDescription.trim(),
                });
            } catch (error) {
                console.error("Failed to scrape LinkedIn job:", card.url, error);

                jobs.push({
                    title: card.title,
                    company: card.company,
                    location: card.location,
                    url: card.url,
                    postedAt: card.postedAt ? new Date(card.postedAt) : undefined,
                    source: "LINKEDIN",
                    description: `${card.title} ${card.company ?? ""} ${card.location ?? ""}`,
                });
            } finally {
                await detailPage.close();
            }
        }

        await browser.close();

        return filterRelevantJobs(jobs);
    }
}
