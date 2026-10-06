export const JOB_SEARCH_PROVIDER_NAMES = [
    "LINKEDIN",
    "CENTER_ISRAEL",
    "GREENHOUSE",
    "LEVER",
    "ASHBY",
    "COMEET",
    "WORKABLE",
    "DEVJOBS",
    "ALLJOBS",
    "DRUSHIM",
    "JOBMASTER",
    "GOTFRIENDS",
    "SQLINK",
    "ETHOSIA",
    "NISHA",
    "JOBIFY",
    "EMPLOYBL",
    "GLASSDOOR",
] as const;

export type JobSearchProviderName = typeof JOB_SEARCH_PROVIDER_NAMES[number];

export type JobSource = JobSearchProviderName
    | "EMAIL_LINK"
    | "EMAIL"
    | "MANUAL"
    | "LOCAL_APPLICATION"
    | "STORAGE_IMPORT"
    | "ATS_REFRESH"
    | "MOCK";

export type JobPageClassification =
    | "job_detail"
    | "category"
    | "search_results"
    | "company_page"
    | "apply_page"
    | "pagination"
    | "unknown";

export type JobExtractionMethod =
    | "official_api"
    | "json_ld"
    | "embedded_json"
    | "source_dom"
    | "heuristic_dom"
    | "llm_fallback"
    | "list_card";

export type JobIngestionQualityState =
    | "HIGH_CONFIDENCE"
    | "MEDIUM_CONFIDENCE"
    | "NEEDS_ENRICHMENT"
    | "REJECTED";

export type JobLocationEligibility = "ELIGIBLE" | "INELIGIBLE" | "NEEDS_VERIFICATION";

export type JobFieldConfidence = Partial<Record<
    "title" | "company" | "location" | "postedAt" | "description" | "employmentType" | "applyUrl",
    number
>>;

export type JobIngestionMetadata = {
    classification?: JobPageClassification;
    classificationReasons?: string[];
    extractionMethod?: JobExtractionMethod;
    fieldConfidence?: JobFieldConfidence;
    qualityScore?: number;
    qualityState?: JobIngestionQualityState;
    locationEligibility?: JobLocationEligibility;
    locationReason?: string;
    detectedTechnologies?: string[];
    canonicalUrl?: string;
    sourceDetail?: Record<string, unknown>;
};

export type ParsedJob = {
    title: string;
    company?: string;
    location?: string;
    url?: string;
    externalJobId?: string;
    postedAt?: Date;
    source: JobSource;
    description: string;
    applyUrl?: string;
    employmentType?: string;
    ingestion?: JobIngestionMetadata;
};
