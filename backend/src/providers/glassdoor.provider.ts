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

type GlassdoorCard = {
    title: string;
    company?: string;
    location?: string;
    url?: string;
    postedAt?: string;
};

const DEFAULT_GLASSDOOR_SEARCH_URLS = [
    "https://www.glassdoor.com/Job/israel-full-stack-jobs-SRCH_IL.0,6_IN119_KO7,17.htm?fromAge=1",
    "https://www.glassdoor.com/Job/israel-backend-jobs-SRCH_IL.0,6_IN119_KO7,14.htm?fromAge=1",
];

function glassdoorSearchUrls(): string[] {
    const configured = process.env.GLASSDOOR_SEARCH_URLS ?? process.env.GLASSDOOR_SEARCH_URL;

    if (!configured) return DEFAULT_GLASSDOOR_SEARCH_URLS;

    return configured
        .split(/[\n,]/)
        .map((url) => url.trim())
        .filter(Boolean);
}

export class GlassdoorProvider implements JobProvider {
    source = "GLASSDOOR";

    async search(): Promise<ParsedJob[]> {
        const browser = await createProviderBrowser();
        const context = await newProviderContext(browser, {
            storageState: hasGlassdoorStorageState() ? getGlassdoorStorageStatePath() : undefined,
        });
        const page = await context.newPage();

        try {
            const cards: GlassdoorCard[] = [];
            const seenCards = new Set<string>();

            for (const searchUrl of glassdoorSearchUrls()) {
                await page.goto(searchUrl, {
                    waitUntil: "domcontentloaded",
                    timeout: 60000,
                });

                await page.waitForTimeout(4000);

                const pageCards = await page.$$eval(
                    "li[data-test*='job'], div[data-test*='job'], a[href*='/job-listing/']",
                    (elements) => {
                        const seen = new Set<string>();

                        return elements
                            .map((element) => {
                                const link =
                                    element instanceof HTMLAnchorElement
                                        ? element
                                        : element.querySelector<HTMLAnchorElement>("a[href*='/job-listing/'], a[href]");
                                const title =
                                    element.querySelector<HTMLElement>("[data-test='job-title'], .job-title, [class*='JobTitle']")?.textContent?.trim() ||
                                    link?.textContent?.trim() ||
                                    "";
                                const company =
                                    element.querySelector<HTMLElement>("[data-test='employer-name'], .employer-name, [class*='Employer']")?.textContent?.trim() ||
                                    undefined;
                                const location =
                                    element.querySelector<HTMLElement>("[data-test='job-location'], .location, [class*='Location']")?.textContent?.trim() ||
                                    undefined;
                                const postedAt =
                                    element.querySelector("time")?.getAttribute("datetime") ||
                                    element.querySelector("time")?.textContent?.trim() ||
                                    element.querySelector<HTMLElement>("[data-test*='job-age'], [class*='JobAge']")?.textContent?.trim() ||
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
                                    /^jobs$/i.test(card.title) ||
                                    !card.url ||
                                    !card.url.includes("/job-listing/") ||
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

            const jobs: ParsedJob[] = [];

            for (const card of cards) {
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

                const detailPage = await context.newPage();

                try {
                    await detailPage.goto(card.url, {
                        waitUntil: "domcontentloaded",
                        timeout: 60000,
                    });

                    const description =
                        await extractDescription(detailPage, [
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
                        description: description ?? card.title,
                    });
                } finally {
                    await detailPage.close();
                }
            }

            return filterRelevantJobs(jobs);
        } finally {
            await context.close();
            await browser.close();
        }
    }
}
