import { JobProvider } from "./job-provider";
import { ParsedJob, JobSource } from "./types";
import { createProviderBrowser, isRelevantJobText, newProviderPage, parsePostedAt } from "./browser-provider-utils";
import { stableExternalId } from "./ats-provider-utils";
import { classifyJobPage } from "./job-page-classifier";
import { extractSourceJobDetail, SourceDomSelectors } from "./source-detail-extractor";
import { SourceAuditTracker } from "./source-audit";

type BoardConfig = {
    source: JobSource;
    label: string;
    defaultUrls: string[];
    envName: string;
    linkSelector: string;
    companySelector?: string;
    locationSelector?: string;
    postedAtSelector?: string;
    detailSelectors?: SourceDomSelectors;
};

type BoardCard = {
    title: string;
    company?: string;
    location?: string;
    url: string;
    postedAt?: string;
    description?: string;
};

function configuredUrls(config: BoardConfig): string[] {
    const configured = process.env[config.envName];
    return (configured ? configured.split(/[\n;]/) : config.defaultUrls)
        .map((value) => value.trim())
        .filter(Boolean);
}

export function isPublicBoardJobDetailUrl(source: JobSource, value: string): boolean {
    try {
        const url = new URL(value);
        const path = url.pathname;
        switch (source) {
            case "DEVJOBS":
                return /devjobs\.co\.il$/i.test(url.hostname) && /\/job-details\/\d+/i.test(path);
            case "JOBMASTER":
                return /jobmaster\.co\.il$/i.test(url.hostname) && /\/jobs\/checknum\.asp$/i.test(path) && /^\d+$/.test(url.searchParams.get("key") ?? "");
            case "NISHA":
                return /nisha\.co\.il$/i.test(url.hostname) && /\/job\/\d+\/?$/i.test(path);
            case "JOBIFY":
                return /jobify\.run$/i.test(url.hostname) && /\/jobs\/[a-z0-9-]*\d{4,}\/?$/i.test(path);
            case "EMPLOYBL":
                return /employbl\.com$/i.test(url.hostname) && /\/jobs\/[a-z0-9-]*\d{4,}\/?$/i.test(path);
            case "ETHOSIA":
                return /\/jobs?\/[a-z0-9-]*\d{4,}|\/positions?\/[a-z0-9-]+/i.test(path);
            default:
                return classifyJobPage({ url: value, hasUniqueJobId: /\d{5,}/.test(value) }).classification === "job_detail";
        }
    } catch {
        return false;
    }
}

function detailLimit(source: JobSource): number {
    const sourceValue = process.env[`${source}_MAX_DETAIL_PAGES`];
    const value = Number(sourceValue ?? process.env.PUBLIC_BOARD_MAX_DETAIL_PAGES ?? 15);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 15;
}

export class PublicJobBoardProvider implements JobProvider {
    source: JobSource;
    auditReport?: SourceAuditTracker["report"];

    constructor(private readonly config: BoardConfig) {
        this.source = config.source;
    }

    async search(): Promise<ParsedJob[]> {
        const audit = new SourceAuditTracker(this.source);
        const searchUrls = configuredUrls(this.config);
        if (!searchUrls.length) {
            console.warn(`[${this.config.label}] No ${this.config.envName} configured — skipping.`);
            this.auditReport = audit.report;
            return [];
        }

        const browser = await createProviderBrowser();
        const listPage = await newProviderPage(browser);
        const detailPage = await newProviderPage(browser);
        const cards: BoardCard[] = [];
        const seen = new Set<string>();
        const jobs: ParsedJob[] = [];

        try {
            for (const searchUrl of searchUrls) {
                try {
                    await listPage.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
                    await listPage.waitForTimeout(1_000);
                    const extracted = await listPage.$$eval(this.config.linkSelector, (links, options) => links.map((node) => {
                        const link = node instanceof HTMLAnchorElement ? node : node.querySelector<HTMLAnchorElement>("a[href]");
                        const container = link?.closest("article,li,[data-job-id],[class*='job-card'],[class*='job_item'],[class*='position-card'],[class*='listing']");
                        const text = (container?.textContent ?? link?.textContent ?? "").replace(/\s+/g, " ").trim();
                        const ariaTitle = link?.getAttribute("aria-label")?.replace(/^view details for\s+/i, "").trim();
                        const title = ariaTitle
                            || container?.querySelector<HTMLElement>("h1,h2,h3,h4,[class*='title'],[class*='position-name'],[data-testid*='title']")?.textContent?.replace(/\s+/g, " ").trim()
                            || link?.textContent?.replace(/\s+/g, " ").trim()
                            || "";
                        const company = container?.querySelector<HTMLElement>(options.companySelector || "[class*='company'],[data-testid*='company']")?.textContent?.replace(/\s+/g, " ").trim() || undefined;
                        const location = container?.querySelector<HTMLElement>(options.locationSelector || "[class*='location'],[class*='city'],[data-testid*='location']")?.textContent?.replace(/\s+/g, " ").trim() || undefined;
                        const time = container?.querySelector(options.postedAtSelector || "time");
                        const postedAt = time?.getAttribute("datetime") || time?.textContent?.trim() || undefined;
                        return { title, company, location, url: link?.href ?? "", postedAt, description: text.slice(0, 1200) };
                    }), {
                        companySelector: this.config.companySelector,
                        locationSelector: this.config.locationSelector,
                        postedAtSelector: this.config.postedAtSelector,
                    });

                    audit.increment("discoveredUrls", extracted.length);
                    for (const card of extracted) {
                        if (!card.url || seen.has(card.url)) continue;
                        if (!isPublicBoardJobDetailUrl(this.source, card.url)) {
                            audit.increment("categoryPagesRejected");
                            audit.reject({ url: card.url, title: card.title, classification: "category", reason: "NON_DETAIL_URL_PATTERN" });
                            continue;
                        }
                        seen.add(card.url);
                        cards.push(card);
                    }
                } catch (error) {
                    audit.increment("parseErrors");
                    audit.reject({ url: searchUrl, reason: `SEARCH_FETCH_ERROR:${error instanceof Error ? error.message.split("\n")[0] : String(error)}` });
                }
            }

            const candidates = [...cards].sort((left, right) =>
                Number(isRelevantJobText(right.title)) - Number(isRelevantJobText(left.title))
            ).slice(0, detailLimit(this.source));
            // A list-card is discovery evidence, not a trustworthy vacancy record.
            // Every source-specific URL contract therefore resolves the detail page
            // before anything can enter normalization/persistence.
            const fetchDetails = true;
            for (const card of candidates) {
                if (fetchDetails) {
                    audit.increment("detailPagesFetched");
                    const result = await extractSourceJobDetail({
                        page: detailPage,
                        url: card.url,
                        source: this.source,
                        selectors: this.config.detailSelectors,
                        fallback: {
                            title: card.title,
                            company: card.company,
                            location: card.location,
                            postedAt: parsePostedAt(card.postedAt),
                            description: card.description,
                            externalJobId: stableExternalId(card.url),
                        },
                    });
                    if (!result.job) {
                        if (result.error) audit.increment("parseErrors");
                        audit.reject({ url: card.url, title: card.title, classification: result.classification.classification, reason: result.error ?? result.classification.reasons[0] });
                        continue;
                    }
                    audit.increment(result.method === "json_ld" ? "structuredDataHits" : "domExtractionHits");
                    audit.increment("classifiedJobPages");
                    audit.increment("normalizedJobs");
                    jobs.push(result.job);
                    continue;
                }

                const classification = classifyJobPage({
                    url: card.url,
                    hasUniqueJobId: /\d{4,}/.test(card.url),
                    hasTitleHeading: Boolean(card.title),
                    hasLocation: Boolean(card.location),
                    descriptionLength: card.description?.length,
                });
                audit.increment("classifiedJobPages");
                audit.increment("normalizedJobs");
                jobs.push({
                    title: card.title,
                    company: card.company,
                    location: card.location,
                    url: card.url,
                    externalJobId: stableExternalId(card.url),
                    postedAt: parsePostedAt(card.postedAt),
                    source: this.source,
                    description: card.description || card.title,
                    ingestion: {
                        classification: classification.classification,
                        classificationReasons: classification.reasons,
                        extractionMethod: "list_card",
                        fieldConfidence: {
                            title: card.title ? 65 : 0,
                            company: card.company ? 55 : 0,
                            location: card.location ? 55 : 0,
                            postedAt: card.postedAt ? 50 : 0,
                            description: 35,
                        },
                    },
                });
            }
            return jobs;
        } finally {
            this.auditReport = audit.report;
            audit.log();
            await detailPage.close().catch(() => undefined);
            await listPage.close().catch(() => undefined);
            await browser.close().catch(() => undefined);
        }
    }
}

export const publicJobBoardProviders = () => ({
    DEVJOBS: new PublicJobBoardProvider({
        source: "DEVJOBS", label: "DevJobs Israel", envName: "DEVJOBS_SEARCH_URLS",
        defaultUrls: ["https://devjobs.co.il/jobs-grid"],
        linkSelector: "a[href*='/job-details/']",
        detailSelectors: {
            title: ["h1", "[class*='job-title']"],
            company: ["[class*='company']", "a[href*='/companies/']"],
            location: ["[class*='location']"],
            description: ["[class*='job-description']", "main"],
        },
    }),
    JOBMASTER: new PublicJobBoardProvider({
        source: "JOBMASTER", label: "JobMaster", envName: "JOBMASTER_SEARCH_URLS",
        defaultUrls: [
            "https://www.jobmaster.co.il/jobs/q-Full-Stack-Developer/",
            "https://www.jobmaster.co.il/jobs/q-Backend-Developer/",
            "https://www.jobmaster.co.il/jobs/q-AI-Engineer/",
        ],
        linkSelector: "a[href*='checknum.asp?key=']",
        detailSelectors: {
            title: ["h1", "[class*='job-title']"],
            company: ["[class*='company']", "[class*='employer']"],
            location: ["[class*='location']", "[class*='area']"],
            description: ["[class*='job-description']", "[class*='description']", "main"],
        },
    }),
    ETHOSIA: new PublicJobBoardProvider({
        source: "ETHOSIA", label: "Ethosia", envName: "ETHOSIA_SEARCH_URLS",
        defaultUrls: [],
        linkSelector: "a[href*='/job/'],a[href*='/jobs/'],a[href*='position']",
    }),
    NISHA: new PublicJobBoardProvider({
        source: "NISHA", label: "Nisha", envName: "NISHA_SEARCH_URLS",
        defaultUrls: ["https://www.nisha.co.il/job_cat/high-tech/"],
        linkSelector: ".item-job.job-main .job-title a[href*='nisha.co.il/job/']",
        postedAtSelector: ".job-date",
        detailSelectors: {
            title: ["h1", ".job-title", "[class*='job-title']"],
            company: ["[itemprop='hiringOrganization'] [itemprop='name']"],
            location: ["[class*='location']"],
            description: [".job-description", "[class*='job-description']", "[class*='description']", "main"],
            postedAt: [".job-date", "time", "[class*='date']"],
        },
    }),
    JOBIFY: new PublicJobBoardProvider({
        source: "JOBIFY", label: "Jobify", envName: "JOBIFY_SEARCH_URLS",
        defaultUrls: ["https://jobify.run/tech/typescript-developer-jobs"],
        linkSelector: "a[href*='jobify.run/jobs/']",
        companySelector: ".mt-1\\.5 span:first-child",
        locationSelector: ".mt-1\\.5 span:nth-child(2)",
        postedAtSelector: ".mt-1\\.5 span:nth-child(3)",
    }),
    EMPLOYBL: new PublicJobBoardProvider({
        source: "EMPLOYBL", label: "Employbl", envName: "EMPLOYBL_SEARCH_URLS",
        defaultUrls: ["https://www.employbl.com/job-listings"],
        linkSelector: "a[href*='employbl.com/jobs/']",
    }),
});
