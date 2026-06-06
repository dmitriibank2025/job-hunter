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

export class AllJobsProvider implements JobProvider {
    source = "ALLJOBS";

    async search(): Promise<ParsedJob[]> {
        const browser = await createProviderBrowser();
        const page = await newProviderPage(browser);

        try {
            const cards: AllJobsCard[] = [];
            const seenCards = new Set<string>();

            for (const searchUrl of allJobsSearchUrls()) {
                await page.goto(searchUrl, {
                    waitUntil: "domcontentloaded",
                    timeout: 60000,
                });

                await page.waitForTimeout(3000);

                const pageCards = await page.$$eval(
                    "a[href*='JobDetails'], a[href*='jobdetails'], a[href*='Job.aspx'], div[class*='job'], li[class*='job']",
                    (elements) => {
                        const seen = new Set<string>();

                        return elements
                            .map((element) => {
                                const link =
                                    element instanceof HTMLAnchorElement
                                        ? element
                                        : element.querySelector<HTMLAnchorElement>(
                                            "a[href*='JobDetails'], a[href*='jobdetails'], a[href*='Job.aspx'], a[href]",
                                        );
                                const container = element.closest("article,li,section,div") ?? element;
                                const text = container.textContent?.replace(/\s+/g, " ").trim() ?? "";
                                const title =
                                    container.querySelector<HTMLElement>("h1,h2,h3,[class*='title'],[class*='Title']")?.textContent?.trim() ||
                                    link?.textContent?.trim() ||
                                    text.split("|")[0]?.trim() ||
                                    "";
                                const company =
                                    container.querySelector<HTMLElement>("[class*='company'],[class*='Company'],[class*='employer']")?.textContent?.trim() ||
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
                            .slice(0, 10);
                    },
                );

                for (const card of pageCards) {
                    if (!card.url || seenCards.has(card.url)) continue;
                    seenCards.add(card.url);
                    cards.push(card);
                }
            }

            return await this.enrichCards(browser, cards);
        } finally {
            await browser.close();
        }
    }

    private async enrichCards(browser: Awaited<ReturnType<typeof createProviderBrowser>>, cards: AllJobsCard[]) {
        const jobs: ParsedJob[] = [];

        for (const card of cards) {
            const url = absoluteUrl(card.url, "https://www.alljobs.co.il");
            if (!url) continue;

            if (!shouldFetchProviderDetails()) {
                jobs.push({
                    title: card.title,
                    company: card.company,
                    location: card.location ?? DEFAULT_SEARCH_LOCATION,
                    url,
                    postedAt: parsePostedAt(card.postedAt),
                    source: "ALLJOBS",
                    description: cardDescription(card),
                });
                continue;
            }

            const detailPage = await newProviderPage(browser);

            try {
                await detailPage.goto(url, {
                    waitUntil: "domcontentloaded",
                    timeout: 15000,
                });

                const description = await extractDescription(detailPage, [
                    "[class*='description']",
                    "[class*='Description']",
                    "[class*='job-content']",
                    "[class*='JobContent']",
                    "main",
                ]);
                const title =
                    card.title ||
                    (await detailPage
                        .locator("h1,h2,[class*='title'],[class*='Title']")
                        .first()
                        .textContent({ timeout: 3000 })
                        .catch(() => null))?.trim() ||
                    (await detailPage.title()).replace(/\s*\|.*$/, "").trim();

                jobs.push({
                    title,
                    company: card.company,
                    location: card.location ?? DEFAULT_SEARCH_LOCATION,
                    url,
                    postedAt: parsePostedAt(card.postedAt),
                    source: "ALLJOBS",
                    description: description ?? card.title,
                });
            } finally {
                await detailPage.close();
            }
        }

        return filterRelevantJobs(jobs);
    }
}
