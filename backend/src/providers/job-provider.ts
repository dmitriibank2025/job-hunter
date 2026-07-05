import { ParsedJob } from "./types";

export interface JobProvider {
    source: string;
    userId?: string;
    search(): Promise<ParsedJob[]>;
}
