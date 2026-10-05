import { JobProvider } from "./job-provider";
import { ParsedJob } from "./types";
import { DEFAULT_SEARCH_KEYWORD_QUERIES, createProviderBrowser, newProviderPage } from "./browser-provider-utils";
import { extractSourceJobDetail } from "./source-detail-extractor";
import { SourceAuditTracker } from "./source-audit";

function maxDetailPages(): number {
    const value = Number(process.env.DRUSHIM_MAX_DETAIL_PAGES ?? 12);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 12;
}

export function isDrushimJobDetailUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return /(?:^|\.)drushim\.co\.il$/i.test(url.hostname)
            && /\/job\/\d+\/[a-z0-9]+\/?$/i.test(url.pathname);
    } catch {
        return false;
    }
}

export class DrushimProvider implements JobProvider {
    source = "DRUSHIM";
    auditReport?: SourceAuditTracker["report"];

    async search(): Promise<ParsedJob[]> {
        const audit = new SourceAuditTracker(this.source);
        const browser = await createProviderBrowser();
        const searchPage = await newProviderPage(browser);
        const detailPage = await newProviderPage(browser);
        const discovered = new Set<string>();
        const jobs: ParsedJob[] = [];

        try {
            for (const keywords of DEFAULT_SEARCH_KEYWORD_QUERIES) {
                const searchUrl = `https://www.drushim.co.il/jobs/search/${encodeURIComponent(keywords)}/`;
                try {
                    await searchPage.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
                    await searchPage.waitForTimeout(1_000);
                    const urls = await searchPage.$$eval("a[href*='/job/']", (links) =>
                        [...new Set(links.map((link) => (link as HTMLAnchorElement).href))],
                    );
                    urls.filter(isDrushimJobDetailUrl).forEach((url) => discovered.add(url));
                } catch (error) {
                    audit.increment("parseErrors");
                    audit.reject({ url: searchUrl, reason: `SEARCH_FETCH_ERROR:${error instanceof Error ? error.message.split("\n")[0] : String(error)}` });
                }
            }

            audit.increment("discoveredUrls", discovered.size);
            for (const url of [...discovered].slice(0, maxDetailPages())) {
                audit.increment("detailPagesFetched");
                const result = await extractSourceJobDetail({
                    page: detailPage,
                    url,
                    source: "DRUSHIM",
                    selectors: {
                        title: ["h1", ".job-title", "[class*='jobTitle']"],
                        company: ["[class*='company-name']", "[class*='companyName']", "[class*='employer']"],
                        location: ["[class*='job-location']", "[class*='location']", "[class*='area']"],
                        description: [".job-description", "#jobDescription", "[class*='jobDescription']", "main"],
                        postedAt: ["time", "[class*='publish-date']", "[class*='date']"],
                    },
                });
                if (!result.job) {
                    if (result.error) audit.increment("parseErrors");
                    if (result.classification.classification === "category") audit.increment("categoryPagesRejected");
                    audit.reject({ url, classification: result.classification.classification, reason: result.error ?? result.classification.reasons[0] });
                    continue;
                }
                audit.increment("classifiedJobPages");
                audit.increment("normalizedJobs");
                audit.increment(result.method === "json_ld" ? "structuredDataHits" : "domExtractionHits");
                jobs.push(result.job);
            }
            return jobs;
        } finally {
            this.auditReport = audit.report;
            audit.log();
            await detailPage.close().catch(() => undefined);
            await searchPage.close().catch(() => undefined);
            await browser.close().catch(() => undefined);
        }
    }
}
