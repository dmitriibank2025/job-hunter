import { JobProvider } from "./job-provider";
import { ParsedJob } from "./types";
import {
    DEFAULT_SEARCH_KEYWORDS,
    absoluteUrl,
    cardDescription,
    createProviderBrowser,
    extractDescription,
    filterRelevantJobs,
    newProviderPage,
    parsePostedAt,
    shouldFetchProviderDetails,
} from "./browser-provider-utils";

type SqlinkCard = {
    title: string;
    company?: string;
    location?: string;
    url?: string;
    postedAt?: string;
};

export class SqlinkProvider implements JobProvider {
    source = "SQLINK";

    async search(): Promise<ParsedJob[]> {
        const browser = await createProviderBrowser();
        const page = await newProviderPage(browser);

        try {
            const searchUrl = "https://www.sqlink.com/hightechjob/";

            await page.goto(searchUrl, {
                waitUntil: "domcontentloaded",
                timeout: 60000,
            });

            await page.waitForTimeout(2500);

            const cards = await page.$$eval(
                "a[href*='/career/']",
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
                                container?.querySelector<HTMLElement>("h1,h2,h3,.title,.job-title,[class*='title']")?.textContent?.trim() ||
                                link?.textContent?.trim() ||
                                text.split("|")[0]?.trim() ||
                                "";
                            const company =
                                container?.querySelector<HTMLElement>(".company,[class*='company']")?.textContent?.trim() ||
                                "SQLINK";
                            const location =
                                container?.querySelector<HTMLElement>(".location,[class*='location'],[class*='area']")?.textContent?.trim() ||
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
                                !card.title ||
                                card.title.length < 15 ||
                                !card.url ||
                                card.url.includes("/blog/") ||
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

            return await this.enrichCards(browser, cards, "https://www.sqlink.com");
        } finally {
            await browser.close();
        }
    }

    private async enrichCards(browser: Awaited<ReturnType<typeof createProviderBrowser>>, cards: SqlinkCard[], baseUrl: string) {
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
                    source: "SQLINK",
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

                jobs.push({
                    title: card.title,
                    company: card.company,
                    location: card.location,
                    url,
                    postedAt: parsePostedAt(card.postedAt),
                    source: "SQLINK",
                    description: description ?? card.title,
                });
            } catch {
                jobs.push({
                    title: card.title,
                    company: card.company,
                    location: card.location,
                    url,
                    postedAt: parsePostedAt(card.postedAt),
                    source: "SQLINK",
                    description: card.title,
                });
            } finally {
                await detailPage.close();
            }
        }

        return filterRelevantJobs(jobs);
    }
}
