import { JobPageClassification } from "./types";

export type JobPageClassificationInput = {
    url: string;
    hasJobPostingJsonLd?: boolean;
    hasUniqueJobId?: boolean;
    hasApplyCta?: boolean;
    hasTitleHeading?: boolean;
    hasEmploymentType?: boolean;
    hasLocation?: boolean;
    descriptionLength?: number;
    canonicalUrl?: string;
    breadcrumbText?: string;
    hasSourceDetailUrl?: boolean;
};

export type JobPageClassificationResult = {
    classification: JobPageClassification;
    confidence: number;
    reasons: string[];
};

const SEARCH_PATTERNS = [
    /\/jobs?\/?(?:search|results)?\/?$/i,
    /searchresults/i,
    /[?&](?:q|query|search|keywords|freetxt)=/i,
    /\/job-listings\/?$/i,
];

const CATEGORY_PATTERNS = [
    /\/jobs?\/(?:cat|category|area)\d+/i,
    /\/jobslobby\/(?!.*\/\d{5,}(?:-\d+)?\/?$).+\/?$/i,
    /\/career\/[^/?#]+\/?$/i,
    /\/jobs\/(?:titles|locations|companies|categories)\/?$/i,
];

const COMPANY_PATTERNS = [
    /\/companies?\//i,
    /\/employers?\//i,
    /\/company\/(?:careers?|jobs?)\/?$/i,
];

const APPLY_PATTERNS = [/\/apply(?:\/|$)/i, /apply\.workable\.com/i, /[?&]apply(?:=|&|$)/i];
const PAGINATION_PATTERNS = [/[?&](?:page|start|offset)=\d+/i, /\/page\/\d+/i];
const DETAIL_PATTERNS = [
    /\/jobslobby\/.+\/\d{5,}(?:-\d+)?\/?$/i,
    /\/job\/\d{4,}(?:\/|$)/i,
    /\/jobs\/view\/(?:[^/]*-)?\d{5,}/i,
    /\/jobs\/[^/?#]*\d{5,}/i,
    /\/career\/[^/?#]+\/[^/?#]+\/?$/i,
    /\/career\/job\/[^/?#]*\d{5,}\/?$/i,
    /\/job-details?\//i,
    /\/positions?\/[^/?#]+\/?$/i,
    /checknum\.asp\?key=\d+/i,
    /UploadSingle\.aspx\?JobID=\d+/i,
];

export function classifyJobPage(input: JobPageClassificationInput): JobPageClassificationResult {
    const reasons: string[] = [];
    const url = input.canonicalUrl || input.url;

    if (input.hasJobPostingJsonLd) {
        return { classification: "job_detail", confidence: 100, reasons: ["JOB_POSTING_JSON_LD"] };
    }

    if (APPLY_PATTERNS.some((pattern) => pattern.test(url)) && !input.hasTitleHeading) {
        return { classification: "apply_page", confidence: 90, reasons: ["APPLY_URL_PATTERN"] };
    }

    if (PAGINATION_PATTERNS.some((pattern) => pattern.test(url)) && SEARCH_PATTERNS.some((pattern) => pattern.test(url))) {
        return { classification: "pagination", confidence: 90, reasons: ["PAGINATION_URL_PATTERN"] };
    }

    if (SEARCH_PATTERNS.some((pattern) => pattern.test(url))) {
        return { classification: "search_results", confidence: 90, reasons: ["SEARCH_URL_PATTERN"] };
    }

    if (COMPANY_PATTERNS.some((pattern) => pattern.test(url))) {
        return { classification: "company_page", confidence: 85, reasons: ["COMPANY_URL_PATTERN"] };
    }

    if (CATEGORY_PATTERNS.some((pattern) => pattern.test(url))) {
        return { classification: "category", confidence: 90, reasons: ["CATEGORY_URL_PATTERN"] };
    }

    let score = 0;
    if (input.hasSourceDetailUrl) {
        score += 35;
        reasons.push("SOURCE_DETAIL_URL_CONTRACT");
    }
    if (DETAIL_PATTERNS.some((pattern) => pattern.test(url))) {
        score += 35;
        reasons.push("JOB_DETAIL_URL_PATTERN");
    }
    if (input.hasUniqueJobId) {
        score += 20;
        reasons.push("UNIQUE_JOB_ID");
    }
    if (input.hasApplyCta) {
        score += 15;
        reasons.push("APPLY_CTA");
    }
    if (input.hasTitleHeading) {
        score += 10;
        reasons.push("TITLE_HEADING");
    }
    if (input.hasLocation) {
        score += 5;
        reasons.push("JOB_LOCATION");
    }
    if (input.hasEmploymentType) {
        score += 5;
        reasons.push("EMPLOYMENT_TYPE");
    }
    if ((input.descriptionLength ?? 0) >= 300) {
        score += 10;
        reasons.push("SUBSTANTIAL_DESCRIPTION");
    }
    if (/job|position|vacanc|משרה/i.test(input.breadcrumbText ?? "")) {
        score += 5;
        reasons.push("JOB_BREADCRUMB");
    }

    if (score >= 45) {
        return { classification: "job_detail", confidence: Math.min(95, score), reasons };
    }

    return {
        classification: "unknown",
        confidence: Math.max(10, 100 - score),
        reasons: reasons.length ? reasons : ["INSUFFICIENT_JOB_SIGNALS"],
    };
}

export function isJobDetailClassification(result: JobPageClassificationResult): boolean {
    return result.classification === "job_detail";
}
