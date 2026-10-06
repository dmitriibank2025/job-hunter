import { JobProvider } from "./job-provider";
import { ParsedJob } from "./types";
import {
    DEFAULT_SEARCH_LOCATION,
    absoluteUrl,
    cardDescription,
    createProviderBrowser,
    extractDescription,
    filterRelevantJobs,
    newProviderPage,
    parsePostedAt,
    shouldFetchProviderDetails,
} from "./browser-provider-utils";
import { extractSourceJobDetail } from "./source-detail-extractor";
import { SourceAuditTracker } from "./source-audit";

type AllJobsCard = {
    title: string;
    company?: string;
    location?: string;
    url?: string;
    postedAt?: string;
};

const DEFAULT_ALLJOBS_SEARCH_URLS = [
    "https://www.alljobs.co.il/SearchResultsGuest.aspx?page=1&position=&type=&freetxt=full%20stack%20developer&city=779&region=",
    "https://www.alljobs.co.il/SearchResultsGuest.aspx?page=1&position=&type=&freetxt=backend%20developer&city=779&region=",
    "https://www.alljobs.co.il/SearchResultsGuest.aspx?page=1&position=&type=&freetxt=node.js%20developer&city=779&region=",
];

function allJobsSearchUrls(): string[] {
    const configured = process.env.ALLJOBS_SEARCH_URLS ?? process.env.ALLJOBS_SEARCH_URL;

    if (!configured) return DEFAULT_ALLJOBS_SEARCH_URLS;

    return configured
        .split(/[\n,]/)
        .map((url) => url.trim())
        .filter(Boolean);
}

function allJobsDetailLimit(): number {
    const value = Number(process.env.ALLJOBS_MAX_DETAIL_PAGES ?? 10);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 10;
}

export function isAllJobsJobDetailUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return /(?:^|\.)alljobs\.co\.il$/i.test(url.hostname)
            && /\/Search\/UploadSingle\.aspx$/i.test(url.pathname)
            && /^\d+$/.test(url.searchParams.get("JobID") ?? "");
    } catch {
        return false;
    }
}

export class AllJobsProvider implements JobProvider {
    source = "ALLJOBS";
    auditReport?: SourceAuditTracker["report"];

    async search(): Promise<ParsedJob[]> {
        const audit = new SourceAuditTracker(this.source);
        const browser = await createProviderBrowser();
        const page = await newProviderPage(browser);

        try {
            const cards: AllJobsCard[] = [];
            const seenCards = new Set<string>();

            for (const searchUrl of allJobsSearchUrls()) {
                try {
                    await page.goto(searchUrl, {
                        waitUntil: "domcontentloaded",
                        timeout: 60000,
                    });

                    await page.waitForTimeout(3000);

                    const pageCards = await page.$$eval(
                    "a[href*='UploadSingle.aspx?JobID=']",
                    (elements) => {
                        const seen = new Set<string>();

                        return elements
                            .map((element) => {
                                const link = element instanceof HTMLAnchorElement ? element : null;
                                const container = element.closest("article,li,section,div") ?? element;
                                const text = container.textContent?.replace(/\s+/g, " ").trim() ?? "";
                                const title =
                                    link?.textContent?.replace(/\s+/g, " ").trim() ||
                                    container.querySelector<HTMLElement>("h1,h2,h3,[class*='title'],[class*='Title']")?.textContent?.trim() ||
                                    text.split("|")[0]?.trim() ||
                                    "";
                                const company =
                                    container.querySelector<HTMLElement>("a[href*='/Employer/HP'],[class*='company'],[class*='Company'],[class*='employer']")?.textContent?.trim() ||
                                    undefined;
                                const location =
                                    container.querySelector<HTMLElement>("[class*='location'],[class*='Location'],[class*='city'],[class*='City']")?.textContent?.trim() ||
                                    undefined;
                                const postedAt =
                                    container.querySelector("time")?.getAttribute("datetime") ||
                                    container.querySelector("time")?.textContent?.trim() ||
                                    container.querySelector<HTMLElement>("[class*='date'],[class*='Date'],[class*='time'],[class*='Time']")?.textContent?.trim() ||
                                    undefined;

                                return {
                                    title,
                                    company,
                                    location,
                                    url: link?.href,
                                    postedAt,
                                };
                            })
                            .filter((card) => {
                                if (
                                    !card.title ||
                                    !card.url ||
                                    !/alljobs\.co\.il/i.test(card.url) ||
                                    seen.has(card.url)
                                ) {
                                    return false;
                                }

                                seen.add(card.url);
                                return true;
                            })
                            .slice(0, 50);
                    },
                );

                for (const card of pageCards) {
                    if (!card.url || seenCards.has(card.url)) continue;
                    if (!isAllJobsJobDetailUrl(card.url)) {
                        audit.increment("categoryPagesRejected");
                        audit.reject({ url: card.url, title: card.title, classification: "unknown", reason: "NON_DETAIL_URL_PATTERN" });
                        continue;
                    }
                    seenCards.add(card.url);
                        cards.push(card);
                    }
                    audit.increment("discoveredUrls", pageCards.length);
                } catch (error) {
                    audit.increment("parseErrors");
                    audit.reject({
                        url: searchUrl,
                        classification: "search_results",
                        reason: `SEARCH_FETCH_ERROR:${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
                    });
                }
            }

            const jobs = await this.enrichCards(browser, cards.slice(0, allJobsDetailLimit()), audit);
            audit.increment("normalizedJobs", jobs.length);
            return jobs;
        } finally {
            this.auditReport = audit.report;
            audit.log();
            await browser.close();
        }
    }

    private async enrichCards(
        browser: Awaited<ReturnType<typeof createProviderBrowser>>,
        cards: AllJobsCard[],
        audit: SourceAuditTracker,
    ) {
        const jobs: ParsedJob[] = [];
        const detailPage = await newProviderPage(browser);

        try {
            for (const card of cards) {
                const url = absoluteUrl(card.url, "https://www.alljobs.co.il");
                if (!url) continue;
                audit.increment("detailPagesFetched");
                const result = await extractSourceJobDetail({
                    page: detailPage,
                    url,
                    source: "ALLJOBS",
                    selectors: {
                        title: ["h1", "[class*='job-title']", "[class*='Title']"],
                        company: ["a[href*='/Employer/HP']", "[class*='company']", "[class*='employer']"],
                        location: ["[class*='location']", "[class*='area']", "[class*='cities']"],
                        description: ["[class*='job-description']", "[class*='Description']", "[class*='job-content']", "main"],
                    },
                    fallback: {
                        title: card.title,
                        company: card.company,
                        location: card.location,
                        postedAt: parsePostedAt(card.postedAt),
                        description: cardDescription(card),
                    },
                });
                if (!result.job) {
                    if (result.error) audit.increment("parseErrors");
                    audit.reject({ url, title: card.title, classification: result.classification.classification, reason: result.error ?? result.classification.reasons[0] });
                    continue;
                }
                audit.increment("classifiedJobPages");
                audit.increment(result.method === "json_ld" ? "structuredDataHits" : "domExtractionHits");
                jobs.push(result.job);
            }
        } finally {
            await detailPage.close().catch(() => undefined);
        }

        return jobs;
    }
}
