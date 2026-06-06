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

type GotFriendsCard = {
    title: string;
    company?: string;
    location?: string;
    url?: string;
    postedAt?: string;
};

export class GotFriendsProvider implements JobProvider {
    source = "GOTFRIENDS";

    async search(): Promise<ParsedJob[]> {
        const browser = await createProviderBrowser();
        const page = await newProviderPage(browser);

        try {
            const cards: GotFriendsCard[] = [];
            const seenCards = new Set<string>();

            for (const keywords of DEFAULT_SEARCH_KEYWORD_QUERIES) {
                const searchUrl = `https://www.gotfriends.co.il/jobslobby/?search=${encodeURIComponent(keywords)}`;

                await page.goto(searchUrl, {
                    waitUntil: "domcontentloaded",
                    timeout: 60000,
                });

                await page.waitForTimeout(2500);

                const pageCards = await page.$$eval(
                    "a[href*='/jobslobby/']",
                    (elements) => {
                        const seen = new Set<string>();

                        return elements
                            .map((element) => {
                                const link =
                                    element instanceof HTMLAnchorElement
                                        ? element
                                        : element.querySelector<HTMLAnchorElement>("a[href]");
                                const title =
                                    element.querySelector<HTMLElement>("h2,h3,.title,.job-title,[class*='title']")?.textContent?.trim() ||
                                    link?.textContent?.trim() ||
                                    "";
                                const company =
                                    element.querySelector<HTMLElement>(".company,[class*='company']")?.textContent?.trim() ||
                                    "GotFriends";
                                const location =
                                    element.querySelector<HTMLElement>(".location,[class*='location'],[class*='area']")?.textContent?.trim() ||
                                    undefined;
                                const postedAt =
                                    element.querySelector("time")?.getAttribute("datetime") ||
                                    element.querySelector("time")?.textContent?.trim() ||
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
                                const pathSegments = card.url
                                    ? new URL(card.url).pathname.split("/").filter(Boolean)
                                    : [];

                                if (
                                    !card.title ||
                                    !card.url ||
                                    card.url.includes("#") ||
                                    pathSegments.length < 4 ||
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

            return await this.enrichCards(browser, cards, "https://www.gotfriends.co.il");
        } finally {
            await browser.close();
        }
    }

    private async enrichCards(browser: Awaited<ReturnType<typeof createProviderBrowser>>, cards: GotFriendsCard[], baseUrl: string) {
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
                    source: "GOTFRIENDS",
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
                    source: "GOTFRIENDS",
                    description: description ?? card.title,
                });
            } catch {
                jobs.push({
                    title: card.title,
                    company: card.company,
                    location: card.location,
                    url,
                    postedAt: parsePostedAt(card.postedAt),
                    source: "GOTFRIENDS",
                    description: card.title,
                });
            } finally {
                await detailPage.close();
            }
        }

        return filterRelevantJobs(jobs);
    }
}
