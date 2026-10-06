import { JobProvider } from "./job-provider";
import { ParsedJob } from "./types";
import { fetchJson, parseNamedBoards, safeDate, stableExternalId } from "./ats-provider-utils";
import { mergeDiscoveredAtsBoards } from "../services/ats-discovery.service";

type AshbyJob = {
    title: string;
    location?: string;
    isListed?: boolean;
    descriptionPlain?: string;
    publishedAt?: string;
    jobUrl?: string;
    applyUrl?: string;
};

export class AshbyProvider implements JobProvider {
    source = "ASHBY";

    async search(): Promise<ParsedJob[]> {
        const boards = await mergeDiscoveredAtsBoards("ashby", parseNamedBoards(process.env.ASHBY_JOB_BOARDS));
        if (!boards.length) {
            console.warn("[Ashby] No ASHBY_JOB_BOARDS configured — skipping.");
            return [];
        }
        const jobs: ParsedJob[] = [];
        for (const board of boards) {
            const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board.key)}?includeCompensation=true`;
            try {
                const result = await fetchJson<{ jobs?: AshbyJob[] }>(url);
                const postings = (result.jobs ?? []).filter((job) => job.isListed !== false);
                for (const posting of postings) {
                    const jobUrl = posting.jobUrl ?? posting.applyUrl;
                    if (!jobUrl) continue;
                    jobs.push({
                        title: posting.title,
                        company: board.company,
                        location: posting.location,
                        url: jobUrl,
                        externalJobId: stableExternalId(jobUrl),
                        postedAt: safeDate(posting.publishedAt),
                        source: "ASHBY",
                        description: posting.descriptionPlain?.trim() || posting.title,
                        applyUrl: posting.applyUrl ?? posting.jobUrl,
                        ingestion: {
                            classification: "job_detail",
                            classificationReasons: ["OFFICIAL_ASHBY_API"],
                            extractionMethod: "official_api",
                            canonicalUrl: jobUrl,
                            fieldConfidence: {
                                title: 100,
                                company: 100,
                                location: posting.location ? 95 : 0,
                                postedAt: posting.publishedAt ? 95 : 0,
                                description: posting.descriptionPlain ? 100 : 20,
                                applyUrl: posting.applyUrl ? 100 : 85,
                            },
                        },
                    });
                }
                console.log(`[Ashby] ${board.company}: ${postings.length} listed jobs`);
            } catch (error) {
                console.error(`[Ashby] ${board.company} failed:`, error instanceof Error ? error.message : error);
            }
        }
        return jobs;
    }
}
