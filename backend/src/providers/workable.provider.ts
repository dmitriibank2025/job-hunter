import { JobProvider } from "./job-provider";
import { ParsedJob } from "./types";
import { fetchJson, parseNamedBoards, safeDate, stripHtml } from "./ats-provider-utils";
import { mergeDiscoveredAtsBoards } from "../services/ats-discovery.service";

type WorkableJob = {
    id?: string;
    shortcode?: string;
    title: string;
    state?: string;
    status?: string;
    url?: string;
    shortlink?: string;
    created_at?: string;
    published_on?: string;
    description?: string;
    full_description?: string;
    requirements?: string;
    location?: { location_str?: string; city?: string; country?: string } | string;
    city?: string;
    country?: string;
    locations?: Array<{ city?: string | null; region?: string | null; country?: string | null }>;
};

export function getWorkableLocation(posting: Pick<WorkableJob, "location" | "city" | "state" | "country" | "locations">): string | undefined {
    const legacyLocation = typeof posting.location === "string"
        ? posting.location
        : posting.location?.location_str ?? [posting.location?.city, posting.location?.country].filter(Boolean).join(", ");
    const currentLocation = [posting.city, posting.state, posting.country]
        .map((value) => value?.trim())
        .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
        .join(", ");
    const listedLocation = posting.locations
        ?.map((entry) => [entry.city, entry.region, entry.country]
            .map((value) => value?.trim())
            .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
            .join(", "))
        .find(Boolean);

    return legacyLocation || currentLocation || listedLocation || undefined;
}

export function isPublishedWorkableJob(posting: Pick<WorkableJob, "state" | "status">): boolean {
    const state = posting.state?.trim().toLowerCase();
    const lifecycle = posting.status?.trim().toLowerCase()
        ?? (["published", "draft", "closed", "archived"].includes(state ?? "") ? state : undefined);
    return !lifecycle || lifecycle === "published";
}

export class WorkableProvider implements JobProvider {
    source = "WORKABLE";

    async search(): Promise<ParsedJob[]> {
        const boards = await mergeDiscoveredAtsBoards("workable", parseNamedBoards(process.env.WORKABLE_ACCOUNTS));
        if (!boards.length) {
            console.warn("[Workable] No WORKABLE_ACCOUNTS configured — skipping.");
            return [];
        }
        const jobs: ParsedJob[] = [];
        for (const board of boards) {
            const url = `https://www.workable.com/api/accounts/${encodeURIComponent(board.key)}?details=true`;
            try {
                const result = await fetchJson<{ jobs?: WorkableJob[] } | WorkableJob[]>(url);
                const allJobs = Array.isArray(result) ? result : result.jobs ?? [];
                // Workable's current response uses `state` for the
                // geographical region. Older responses used it as lifecycle.
                const postings = allJobs.filter(isPublishedWorkableJob);
                for (const posting of postings) {
                    const location = getWorkableLocation(posting);
                    const postedAtValue = posting.published_on ?? posting.created_at;
                    const jobUrl = posting.url ?? posting.shortlink;
                    if (!jobUrl) continue;
                    jobs.push({
                        title: posting.title,
                        company: board.company,
                        location: location || undefined,
                        url: jobUrl,
                        externalJobId: posting.id ?? posting.shortcode,
                        postedAt: safeDate(postedAtValue),
                        source: "WORKABLE",
                        description: stripHtml([posting.description, posting.full_description, posting.requirements].filter(Boolean).join("\n")) || posting.title,
                        applyUrl: posting.url ?? posting.shortlink,
                        ingestion: {
                            classification: "job_detail",
                            classificationReasons: ["OFFICIAL_WORKABLE_API"],
                            extractionMethod: "official_api",
                            canonicalUrl: jobUrl,
                            fieldConfidence: {
                                title: 100,
                                company: 100,
                                location: location ? 95 : 0,
                                postedAt: postedAtValue ? 95 : 0,
                                description: posting.description || posting.full_description ? 100 : 20,
                                applyUrl: jobUrl ? 90 : 0,
                            },
                        },
                    });
                }
                console.log(`[Workable] ${board.company}: ${postings.length} published jobs`);
            } catch (error) {
                console.error(`[Workable] ${board.company} failed:`, error instanceof Error ? error.message : error);
            }
        }
        return jobs;
    }
}
