import { JobProvider } from "./job-provider";
import { ParsedJob } from "./types";
import {
    DEFAULT_SEARCH_KEYWORDS,
    DEFAULT_SEARCH_KEYWORD_QUERIES,
    absoluteUrl,
    cardDescription,
    createProviderBrowser,
    extractDescription,
    filterRelevantJobs,
    newProviderPage,
    parsePostedAt,
    shouldFetchProviderDetails,
} from "./browser-provider-utils";

type DrushimCard = {
    title: string;
    company?: string;
    location?: string;
    url?: string;
    postedAt?: string;
};

export class DrushimProvider implements JobProvider {
    source = "DRUSHIM";

    async search(): Promise<ParsedJob[]> {
        const browser = await createProviderBrowser();
        const page = await newProviderPage(browser);

        try {
            const cards: DrushimCard[] = [];
            const seenCards = new Set<string>();

            for (const keywords of DEFAULT_SEARCH_KEYWORD_QUERIES) {
                const searchUrl = `https://www.drushim.co.il/jobs/search/${encodeURIComponent(keywords)}/`;

                await page.goto(searchUrl, {
                    waitUntil: "domcontentloaded",
                    timeout: 60000,
                });

                await page.waitForTimeout(2500);

                const pageCards = await page.$$eval(
                    "a[href*='/job/']",
                    (elements) => {
                        const seen = new Set<string>();

                        return elements
                            .map((element) => {
                                const link =
                                    element instanceof HTMLAnchorElement
                                        ? element
                                        : element.querySelector<HTMLAnchorElement>("a[href]");
                                const container = element.closest("article,li,section,div");
                                const text = container?.textContent?.replace(/\s+/g, " ").trim() ?? "";
                                const title =
                                    container?.querySelector<HTMLElement>("h1,h2,h3,.job-title,.title,[class*='title']")?.textContent?.trim() ||
                                    link?.textContent?.trim() ||
                                    text.split("|")[0]?.trim() ||
                                    "";

                                const company =
                                    container?.querySelector<HTMLElement>(".company,.company-name,[class*='company']")?.textContent?.trim() ||
                                    undefined;
                                const location =
                                    container?.querySelector<HTMLElement>(".location,[class*='location'],[class*='city']")?.textContent?.trim() ||
                                    undefined;
                                const postedAt =
                                    container?.querySelector("time")?.getAttribute("datetime") ||
                                    container?.querySelector("time")?.textContent?.trim() ||
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
                                    !card.url ||
                                    !/\/job\/\d+\/[^/]+\/?$/i.test(card.url) ||
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

            return await this.enrichCards(browser, cards, "https://www.drushim.co.il");
        } finally {
            await browser.close();
        }
    }

    private async enrichCards(browser: Awaited<ReturnType<typeof createProviderBrowser>>, cards: DrushimCard[], baseUrl: string) {
        const jobs: ParsedJob[] = [];

        for (const card of cards) {
            const url = absoluteUrl(card.url, baseUrl);
            if (!url) continue;

            if (!shouldFetchProviderDetails()) {
                jobs.push({
                    title: card.title,
                    company: card.company,
                    location: card.location,
                    url,
                    postedAt: parsePostedAt(card.postedAt),
                    source: "DRUSHIM",
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

                const description =
                    await extractDescription(detailPage, [
                        ".job-description",
                        ".jobDescription",
                        "[class*='description']",
                        "main",
                    ]);
                const title =
                    card.title ||
                    (await detailPage
                        .locator("h1,h2,[class*='title']")
                        .first()
                        .textContent({ timeout: 3000 })
                        .catch(() => null))?.trim() ||
                    (await detailPage.title()).replace(/\s*\|.*$/, "").trim();

                jobs.push({
                    title,
                    company: card.company,
                    location: card.location,
                    url,
                    postedAt: parsePostedAt(card.postedAt),
                    source: "DRUSHIM",
                    description: description ?? card.title,
                });
            } finally {
                await detailPage.close();
            }
        }

        return filterRelevantJobs(jobs);
    }
}
