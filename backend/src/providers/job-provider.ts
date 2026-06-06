import { ParsedJob } from "./types";

export interface JobProvider {
    source: string;
    search(): Promise<ParsedJob[]>;
}