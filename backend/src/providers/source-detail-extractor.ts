import { Page } from "playwright";
import { stableExternalId } from "./ats-provider-utils";
import { classifyJobPage, JobPageClassificationResult } from "./job-page-classifier";
import { extractJobPostingFromHtml, hasJobPostingJsonLd } from "./structured-job-extractor";
import { JobSource, ParsedJob } from "./types";
import { parsePostedAt } from "./browser-provider-utils";

export type SourceDomSelectors = {
    title?: string[];
    company?: string[];
    location?: string[];
    description?: string[];
    descriptionParts?: string[];
    postedAt?: string[];
    employmentType?: string[];
    apply?: string[];
};

export type DetailExtractionResult = {
    job: ParsedJob | null;
    classification: JobPageClassificationResult;
    method?: "json_ld" | "source_dom";
    error?: string;
};

async function firstText(page: Page, selectors: string[] = []): Promise<string | undefined> {
    for (const selector of selectors) {
        const value = await page.locator(selector).first().textContent({ timeout: 1500 }).catch(() => null);
        const cleaned = value?.replace(/\s+/g, " ").trim();
        if (cleaned) return cleaned;
    }
    return undefined;
}

async function firstHref(page: Page, selectors: string[] = []): Promise<string | undefined> {
    for (const selector of selectors) {
        const value = await page.locator(selector).first().getAttribute("href", { timeout: 1500 }).catch(() => null);
        if (!value) continue;
        try {
            return new URL(value, page.url()).toString();
        } catch {
            continue;
        }
    }
    return undefined;
}

async function joinedText(page: Page, selectors: string[] = []): Promise<string | undefined> {
    for (const selector of selectors) {
        const values = await page.locator(selector).allInnerTexts().catch(() => []);
        const cleaned = values.map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean);
        if (cleaned.length) return cleaned.join("\n");
    }
    return undefined;
}

function conciseError(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).split("\n", 1)[0].slice(0, 400);
}

export function mergeStructuredJobFallback(structured: ParsedJob, fallback: Partial<ParsedJob>): ParsedJob {
    const company = structured.company ?? fallback.company;
    const location = structured.location ?? fallback.location;
    const postedAt = structured.postedAt ?? fallback.postedAt;
    const employmentType = structured.employmentType ?? fallback.employmentType;
    const applyUrl = structured.applyUrl ?? fallback.applyUrl;
    const confidence = structured.ingestion?.fieldConfidence;

    return {
        ...structured,
        company,
        location,
        postedAt,
        employmentType,
        applyUrl,
        ingestion: structured.ingestion ? {
            ...structured.ingestion,
            fieldConfidence: confidence ? {
                ...confidence,
                company: confidence.company || (company ? 55 : 0),
                location: confidence.location || (location ? 55 : 0),
                postedAt: confidence.postedAt || (postedAt ? 50 : 0),
                employmentType: confidence.employmentType || (employmentType ? 50 : 0),
                applyUrl: confidence.applyUrl || (applyUrl ? 50 : 0),
            } : confidence,
        } : structured.ingestion,
    };
}

export async function extractSourceJobDetail(input: {
    page: Page;
    url: string;
    source: JobSource;
    selectors?: SourceDomSelectors;
    fallback?: Partial<ParsedJob>;
    navigationTimeoutMs?: number;
    hasSourceDetailUrl?: boolean;
}): Promise<DetailExtractionResult> {
    const { page, source, selectors = {}, fallback = {} } = input;
    try {
        await page.goto(input.url, {
            waitUntil: "domcontentloaded",
            timeout: input.navigationTimeoutMs ?? 30_000,
        });
        await page.waitForTimeout(500);
        const html = await page.content();
        const structured = extractJobPostingFromHtml(html, page.url(), source);
        if (structured) {
            return {
                job: mergeStructuredJobFallback(structured, fallback),
                method: "json_ld",
                classification: classifyJobPage({ url: page.url(), hasJobPostingJsonLd: true }),
            };
        }

        const title = await firstText(page, selectors.title ?? ["h1", "[class*='job-title']", "[data-testid*='title']"])
            ?? fallback.title;
        const company = await firstText(page, selectors.company ?? ["[class*='company-name']", "[class*='employer']", "[data-testid*='company']"])
            ?? fallback.company;
        const location = await firstText(page, selectors.location ?? ["[class*='job-location']", "[class*='location']", "[data-testid*='location']"])
            ?? fallback.location;
        const description = await joinedText(page, selectors.descriptionParts)
            ?? await firstText(page, selectors.description ?? ["[class*='job-description']", "[class*='description']", "article", "main"])
            ?? fallback.description
            ?? "";
        const postedAtText = await firstText(page, selectors.postedAt ?? ["time", "[class*='posted']", "[class*='date']"]);
        const employmentType = await firstText(page, selectors.employmentType ?? ["[class*='employment-type']", "[class*='job-type']"])
            ?? fallback.employmentType;
        const applyUrl = await firstHref(page, selectors.apply ?? ["a[href*='apply']", "a:has-text('Apply')", "a:has-text('הגשת מועמדות')"])
            ?? fallback.applyUrl;
        const classification = classifyJobPage({
            url: page.url(),
            hasJobPostingJsonLd: hasJobPostingJsonLd(html),
            hasUniqueJobId: /\d{5,}/.test(page.url()),
            hasApplyCta: Boolean(applyUrl),
            hasTitleHeading: Boolean(title),
            hasEmploymentType: Boolean(employmentType),
            hasLocation: Boolean(location),
            descriptionLength: description.length,
            breadcrumbText: await firstText(page, ["[class*='breadcrumb']", "nav[aria-label*='breadcrumb']"]),
            hasSourceDetailUrl: input.hasSourceDetailUrl,
        });

        if (classification.classification !== "job_detail" || !title || description.length < 80) {
            return { job: null, classification };
        }

        const url = page.url();
        const postedAt = parsePostedAt(postedAtText) ?? fallback.postedAt;
        return {
            method: "source_dom",
            classification,
            job: {
                title,
                company: company?.trim() || undefined,
                location: location?.trim() || undefined,
                url,
                applyUrl,
                externalJobId: fallback.externalJobId ?? stableExternalId(url),
                postedAt,
                employmentType,
                source,
                description,
                ingestion: {
                    classification: classification.classification,
                    classificationReasons: classification.reasons,
                    extractionMethod: "source_dom",
                    canonicalUrl: url,
                    fieldConfidence: {
                        title: title ? 80 : 0,
                        company: company ? 70 : 0,
                        location: location ? 65 : 0,
                        postedAt: postedAt ? 60 : 0,
                        description: description.length >= 500 ? 85 : 60,
                        employmentType: employmentType ? 60 : 0,
                        applyUrl: applyUrl ? 80 : 0,
                    },
                },
            },
        };
    } catch (error) {
        return {
            job: null,
            error: conciseError(error),
            classification: { classification: "unknown", confidence: 0, reasons: ["DETAIL_FETCH_ERROR"] },
        };
    }
}
