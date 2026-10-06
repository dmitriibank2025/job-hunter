import { ParsedJob } from "./types";
import { SourceIngestionAuditReport } from "./source-audit";

export interface JobProvider {
    source: string;
    userId?: string;
    auditReport?: SourceIngestionAuditReport;
    search(): Promise<ParsedJob[]>;
}
