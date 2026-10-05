import { JobProvider } from "./job-provider";
import { ParsedJob } from "./types";
import { fetchJson, parseNamedBoards, safeDate, stripHtml } from "./ats-provider-utils";
import { mergeDiscoveredAtsBoards } from "../services/ats-discovery.service";

type LeverPosting = {
    id: string;
    text: string;
    hostedUrl?: string;
    applyUrl?: string;
    createdAt?: number;
    descriptionPlain?: string;
    additionalPlain?: string;
    lists?: Array<{ text?: string; content?: string }>;
    categories?: { location?: string; team?: string; department?: string; commitment?: string };
};

export class LeverProvider implements JobProvider {
    source = "LEVER";

    async search(): Promise<ParsedJob[]> {
        const boards = await mergeDiscoveredAtsBoards("lever", parseNamedBoards(process.env.LEVER_SITES));
        if (!boards.length) {
            console.warn("[Lever] No LEVER_SITES configured — skipping.");
            return [];
        }
        const jobs: ParsedJob[] = [];
        for (const board of boards) {
            const host = board.region === "eu" ? "api.eu.lever.co" : "api.lever.co";
            const url = `https://${host}/v0/postings/${encodeURIComponent(board.key)}?mode=json&limit=200`;
            try {
                const postings = await fetchJson<LeverPosting[]>(url);
                for (const posting of postings) {
                    const description = [
                        posting.descriptionPlain,
                        ...(posting.lists ?? []).map((item) => `${item.text ?? ""} ${stripHtml(item.content)}`),
                        posting.additionalPlain,
                    ].filter(Boolean).join("\n").trim();
                    jobs.push({
                        title: posting.text,
                        company: board.company,
                        location: posting.categories?.location,
                        url: posting.hostedUrl ?? posting.applyUrl,
                        externalJobId: posting.id,
                        postedAt: safeDate(posting.createdAt),
                        source: "LEVER",
                        description: description || posting.text,
                        applyUrl: posting.applyUrl ?? posting.hostedUrl,
                        employmentType: posting.categories?.commitment,
                        ingestion: {
                            classification: "job_detail",
                            classificationReasons: ["OFFICIAL_LEVER_API"],
                            extractionMethod: "official_api",
                            canonicalUrl: posting.hostedUrl ?? posting.applyUrl,
                            fieldConfidence: {
                                title: 100,
                                company: 100,
                                location: posting.categories?.location ? 95 : 0,
                                postedAt: posting.createdAt ? 95 : 0,
                                description: description ? 100 : 20,
                                employmentType: posting.categories?.commitment ? 95 : 0,
                                applyUrl: posting.applyUrl ? 100 : 80,
                            },
                        },
                    });
                }
                console.log(`[Lever] ${board.company}: ${postings.length} published jobs`);
            } catch (error) {
                console.error(`[Lever] ${board.company} failed:`, error instanceof Error ? error.message : error);
            }
        }
        return jobs;
    }
}
