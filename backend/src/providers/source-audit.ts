import { JobPageClassification, JobSource } from "./types";

export type RejectedJobExample = {
    url?: string;
    title?: string;
    classification?: JobPageClassification;
    reason: string;
};

export type SourceIngestionAuditReport = {
    source: JobSource | string;
    discoveredUrls: number;
    classifiedJobPages: number;
    categoryPagesRejected: number;
    detailPagesFetched: number;
    structuredDataHits: number;
    domExtractionHits: number;
    llmFallbackHits: number;
    normalizedJobs: number;
    locationRejected: number;
    relevanceRejected: number;
    duplicates: number;
    savedJobs: number;
    parseErrors: number;
    rejectedExamples: RejectedJobExample[];
};

export class SourceAuditTracker {
    readonly report: SourceIngestionAuditReport;

    constructor(source: JobSource | string) {
        this.report = {
            source,
            discoveredUrls: 0,
            classifiedJobPages: 0,
            categoryPagesRejected: 0,
            detailPagesFetched: 0,
            structuredDataHits: 0,
            domExtractionHits: 0,
            llmFallbackHits: 0,
            normalizedJobs: 0,
            locationRejected: 0,
            relevanceRejected: 0,
            duplicates: 0,
            savedJobs: 0,
            parseErrors: 0,
            rejectedExamples: [],
        };
    }

    increment(field: Exclude<keyof SourceIngestionAuditReport, "source" | "rejectedExamples">, amount = 1) {
        this.report[field] += amount;
    }

    reject(example: RejectedJobExample) {
        if (this.report.rejectedExamples.length < 8) this.report.rejectedExamples.push(example);
    }

    log(phase: "EXTRACTION_COMPLETE" | "PERSISTENCE_COMPLETE" = "EXTRACTION_COMPLETE") {
        console.log(`[Source Audit] ${JSON.stringify({ phase, ...this.report })}`);
    }
}
