import { JobProvider } from "./job-provider";
import { ParsedJob } from "./types";
import { createProviderBrowser, newProviderPage } from "./browser-provider-utils";
import { extractSourceJobDetail } from "./source-detail-extractor";
import { SourceAuditTracker } from "./source-audit";

const DEFAULT_CATEGORY_URLS = [
    "https://www.sqlink.com/career/%D7%A4%D7%99%D7%AA%D7%95%D7%97-%D7%AA%D7%95%D7%9B%D7%A0%D7%94-webmobile/",
    "https://www.sqlink.com/career/bidbabig-data/",
];

function categoryUrls(): string[] {
    return (process.env.SQLINK_CATEGORY_URLS ?? DEFAULT_CATEGORY_URLS.join(";"))
        .split(/[;\n]/).map((value) => value.trim()).filter(Boolean);
}

export function isSqlinkJobDetailUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        if (!/sqlink\.com$/i.test(parsed.hostname.replace(/^www\./, ""))) return false;
        if (/\.(?:pdf|docx?|xlsx?|zip)$/i.test(parsed.pathname) || /\/media\//i.test(parsed.pathname)) return false;
        if (/\/career\/(?:[^/]+\/){0,1}[^/]+\/?$/i.test(parsed.pathname) && !/\d{4,}/.test(url)) return false;
        return /\d{5,}|jobid|positionid|\/job\//i.test(url);
    } catch {
        return false;
    }
}

export class SqlinkProvider implements JobProvider {
    source = "SQLINK";
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
                    const links = await discoveryPage.$$eval("a[href]", (nodes) =>
                        [...new Set(nodes.map((node) => (node as HTMLAnchorElement).href))],
                    );
                    links.filter(isSqlinkJobDetailUrl).forEach((url) => urls.add(url));
                } catch {
                    audit.increment("parseErrors");
                    audit.reject({ url: categoryUrl, classification: "category", reason: "CATEGORY_DISCOVERY_ERROR" });
                }
            }

            audit.increment("discoveredUrls", urls.size);
            if (urls.size === 0) audit.reject({ classification: "category", reason: "NO_DETAIL_URLS_ON_CATEGORY_PAGES" });
            const limit = Math.max(1, Number(process.env.SQLINK_MAX_DETAIL_PAGES ?? 12) || 12);
            for (const url of [...urls].slice(0, limit)) {
                audit.increment("detailPagesFetched");
                const result = await extractSourceJobDetail({
                    page: detailPage,
                    url,
                    source: "SQLINK",
                    selectors: {
                        title: ["h1", ".job-title", "[class*='position-title']"],
                        company: ["[class*='company']", "[class*='employer']"],
                        location: ["[class*='location']", "[class*='area']"],
                        description: ["[class*='job-description']", "[class*='description']", "main"],
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
