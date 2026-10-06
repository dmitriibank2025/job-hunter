import { ParsedJob, JobIngestionQualityState, JobLocationEligibility } from "./types";

const ISRAEL_TERMS = [
    "israel", "tel aviv", "tel-aviv", "tel aviv-yafo", "ramat gan", "herzliya", "petah tikva",
    "rishon lezion", "rishon le zion", "rehovot", "ra'anana", "raanana", "jerusalem", "haifa",
    "netanya", "central district", "center district", "ישראל", "תל אביב", "ת\"א", "ת״א", "המרכז", "השרון", "רמת גן", "הרצליה",
    "פתח תקווה", "ראשון לציון", "רחובות", "רעננה", "ירושלים", "חיפה", "נתניה",
];

const EXPLICIT_FOREIGN_TERMS = [
    "poland", "romania", "bucharest", "germany", "berlin", "munich", "france", "paris", "spain", "italy", "portugal",
    "united kingdom", "london", "united states", "usa", "new york", "san francisco", "boston", "chicago", "austin",
    "seattle", "california", "massachusetts", "texas", "canada", "toronto", "vancouver", "india", "australia", "singapore",
    "netherlands", "sweden", "denmark", "ireland", "czech", "hungary", "ukraine", "greece", "colombia",
    "south korea", "bulgaria", "mexico", "brazil", "argentina", "chile", "united arab emirates", "japan", "china",
    "philippines", "south africa", "turkey", "belgium", "austria", "switzerland", "norway", "finland", "estonia",
    "latvia", "lithuania", "croatia", "serbia",
];

const TECHNOLOGIES = [
    "node.js", "nodejs", "typescript", "javascript", "react", "next.js", "nestjs", "express", "python",
    "aws", "postgresql", "mongodb", "redis", "docker", "kubernetes", "microservices", "distributed systems",
    "event-driven", "kafka", "rabbitmq", "sqs", "llm", "rag", "ai agents", "mcp",
];

function includesAny(value: string, terms: string[]): boolean {
    const normalized = value.toLowerCase();
    return terms.some((term) => normalized.includes(term));
}

export function evaluateIsraelEligibility(job: Pick<ParsedJob, "title" | "location" | "description">): {
    eligibility: JobLocationEligibility;
    reason: string;
} {
    const location = (job.location ?? "").trim();
    const descriptiveText = `${job.title} ${job.description.slice(0, 1200)}`.toLowerCase();
    const remote = /\bremote\b|מרחוק/i.test(location || job.title);
    const israelInLocation = /^IL$/i.test(location) || includesAny(location, ISRAEL_TERMS);
    const israelInDescription = includesAny(descriptiveText, ISRAEL_TERMS);
    const foreign = includesAny(location, EXPLICIT_FOREIGN_TERMS);

    // The explicit location field has precedence over incidental words in the body.
    if (remote && foreign && !israelInLocation) return { eligibility: "INELIGIBLE", reason: "REMOTE_EXPLICIT_FOREIGN_COUNTRY" };
    if (foreign && !israelInLocation) return { eligibility: "INELIGIBLE", reason: "EXPLICIT_FOREIGN_LOCATION" };
    if (israelInLocation) return { eligibility: "ELIGIBLE", reason: "ISRAEL_LOCATION_SIGNAL" };
    if (remote) return { eligibility: "NEEDS_VERIFICATION", reason: "REMOTE_WITHOUT_COUNTRY" };
    if (!location) {
        return israelInDescription
            ? { eligibility: "NEEDS_VERIFICATION", reason: "ISRAEL_ONLY_IN_DESCRIPTION" }
            : { eligibility: "NEEDS_VERIFICATION", reason: "MISSING_LOCATION" };
    }
    return { eligibility: "NEEDS_VERIFICATION", reason: "UNRECOGNIZED_LOCATION" };
}

function validUrl(value?: string): boolean {
    if (!value) return false;
    try {
        return ["http:", "https:"].includes(new URL(value).protocol);
    } catch {
        return false;
    }
}

function realCompany(job: ParsedJob): boolean {
    const company = job.company?.trim().toLowerCase();
    if (!company) return false;
    return company !== job.source.toLowerCase()
        && !/^(unknown|n\/a|confidential|job board|-?\s*חסוי\s*-?)$/i.test(company);
}

export function scoreJobQuality(job: ParsedJob): {
    score: number;
    state: JobIngestionQualityState;
    locationEligibility: JobLocationEligibility;
    locationReason: string;
    detectedTechnologies: string[];
} {
    let score = 0;
    if (job.title?.trim() && !/^(job|jobs|position|view|apply)$/i.test(job.title.trim())) score += 20;
    if (realCompany(job)) score += 20;
    if (validUrl(job.url)) score += 15;
    const location = evaluateIsraelEligibility(job);
    if (location.eligibility === "ELIGIBLE") score += 10;
    if (job.description.trim().length > 500) score += 10;
    if (job.postedAt && !Number.isNaN(job.postedAt.getTime())) score += 10;
    if (job.employmentType?.trim()) score += 5;
    const text = `${job.title} ${job.description}`.toLowerCase();
    const detectedTechnologies = TECHNOLOGIES.filter((technology) => text.includes(technology));
    if (detectedTechnologies.length) score += 5;
    if (validUrl(job.applyUrl)) score += 5;

    const classification = job.ingestion?.classification;
    const rejected = Boolean(classification && classification !== "job_detail" && classification !== "unknown")
        || location.eligibility === "INELIGIBLE"
        || !job.title?.trim()
        || !validUrl(job.url);
    const state: JobIngestionQualityState = rejected
        ? "REJECTED"
        : score >= 75
            ? "HIGH_CONFIDENCE"
        : score >= 60
            ? "MEDIUM_CONFIDENCE"
                : "NEEDS_ENRICHMENT";

    return {
        score,
        state,
        locationEligibility: location.eligibility,
        locationReason: location.reason,
        detectedTechnologies,
    };
}

export function withJobQuality(job: ParsedJob): ParsedJob {
    const quality = scoreJobQuality(job);
    return {
        ...job,
        ingestion: {
            ...job.ingestion,
            qualityScore: quality.score,
            qualityState: quality.state,
            locationEligibility: quality.locationEligibility,
            locationReason: quality.locationReason,
            detectedTechnologies: quality.detectedTechnologies,
        },
    };
}
