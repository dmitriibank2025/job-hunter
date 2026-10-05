import { JobProvider } from "./job-provider";
import { ParsedJob } from "./types";
import { createProviderBrowser, newProviderPage } from "./browser-provider-utils";
import { extractSourceJobDetail } from "./source-detail-extractor";
import { SourceAuditTracker } from "./source-audit";

const DEFAULT_CATEGORY_URLS = [
    "https://www.gotfriends.co.il/jobslobby/software/full-stack-developer/",
    "https://www.gotfriends.co.il/jobslobby/software/backend-developer/",
    "https://www.gotfriends.co.il/jobslobby/software/nodejs-developer/",
    "https://www.gotfriends.co.il/jobslobby/ai/ai-engineer/",
    "https://www.gotfriends.co.il/jobslobby/ai/llm-engineer/",
];

function categoryUrls(): string[] {
    return (process.env.GOTFRIENDS_CATEGORY_URLS ?? DEFAULT_CATEGORY_URLS.join(";"))
        .split(/[;\n]/).map((value) => value.trim()).filter(Boolean);
}

export function isGotFriendsJobDetailUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return /(?:^|\.)gotfriends\.co\.il$/i.test(url.hostname)
            && /\/jobslobby\/.+\/\d{5,}(?:-\d+)?\/?$/i.test(url.pathname);
    } catch {
        return false;
    }
}

export class GotFriendsProvider implements JobProvider {
    source = "GOTFRIENDS";
    auditReport?: SourceAuditTracker["report"];

    async search(): Promise<ParsedJob[]> {
        const audit = new SourceAuditTracker(this.source);
        const browser = await createProviderBrowser();
        const discoveryPage = await newProviderPage(browser);
        const detailPage = await newProviderPage(browser);
        const urls = new Set<string>();
        const jobs: ParsedJob[] = [];

        try {
            for (const categoryUrl of categoryUrls()) {
                try {
                    await discoveryPage.goto(categoryUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
                    await discoveryPage.waitForTimeout(800);
                    const found = await discoveryPage.$$eval("a[href*='/jobslobby/']", (links) =>
                        [...new Set(links.map((link) => (link as HTMLAnchorElement).href))],
                    );
                    found.filter(isGotFriendsJobDetailUrl).forEach((url) => urls.add(url));
                } catch {
                    audit.increment("parseErrors");
                    audit.reject({ url: categoryUrl, classification: "category", reason: "CATEGORY_DISCOVERY_ERROR" });
                }
            }

            audit.increment("discoveredUrls", urls.size);
            const limit = Math.max(1, Number(process.env.GOTFRIENDS_MAX_DETAIL_PAGES ?? 15) || 15);
            for (const url of [...urls].slice(0, limit)) {
                audit.increment("detailPagesFetched");
                const result = await extractSourceJobDetail({
                    page: detailPage,
                    url,
                    source: "GOTFRIENDS",
                    selectors: {
                        title: [".positionItem.jobs_list .item > a.position h1.title"],
                        // GotFriends often anonymizes the client; never infer a company from prose.
                        company: [],
                        location: [".positionItem.jobs_list .item_content .info.meta .info-data"],
                        descriptionParts: [".positionItem.jobs_list .item_content .inner > .desc"],
                        postedAt: [],
                        employmentType: [],
                        apply: [],
                    },
                });
                if (!result.job) {
                    if (result.error) audit.increment("parseErrors");
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
            await discoveryPage.close().catch(() => undefined);
            await browser.close().catch(() => undefined);
        }
    }
}
