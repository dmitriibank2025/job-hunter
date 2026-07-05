export type SearchPreferences = {
    targetRoles?: string[];
    targetLocations?: string[];
    requiredTech?: string[];
    excludedKeywords?: string[];
    excludedTitleKeywords?: string[];
    dateRangeDays?: number;
    gmailScanDays?: number;
    minMatchScore?: number;
};

type SearchableJob = {
    title: string;
    company?: string | null;
    location?: string | null;
    description: string;
    postedAt?: Date | string | null;
};

export type SearchPreferenceFilterStats = {
    input: number;
    output: number;
    excludedKeyword: number;
    titleStopword: number;
    targetRole: number;
    targetLocation: number;
    requiredTech: number;
    dateRange: number;
};

const ROLE_ALIASES: Record<string, string[]> = {
    frontend: ["frontend", "front-end", "front end", "react", "ui developer", "web developer"],
    backend: ["backend", "back-end", "back end", "node.js", "nodejs", "server-side", "api developer"],
    fullstack: ["fullstack", "full-stack", "full stack", "full-stack developer", "full stack developer"],
};

// Suggested values for `excludedTitleKeywords` (seniority levels / role categories that
// commonly don't fit a dev search). Not applied automatically — callers opt in by putting
// these (or their own words) into SearchPreferences.excludedTitleKeywords.
export const SUGGESTED_EXCLUDED_TITLE_KEYWORDS: string[] = [
    "senior",
    "sr.",
    "lead",
    "principal",
    "staff",
    "director",
    "head of",
    "vp",
    "chief",
    "manager",
    "qa",
    "quality assurance",
    "sdet",
    "devops",
    "sre",
    "site reliability",
    "scrum master",
    "product manager",
    "project manager",
    "business analyst",
    "data analyst",
    "data scientist",
    "sales",
    "marketing",
    "recruiter",
    "talent acquisition",
    "customer success",
    "support engineer",
];

function normalizeTerm(value: string): string {
    return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function parsePreferenceTerms(value?: string | string[] | null): string[] {
    if (Array.isArray(value)) {
        return value.map((item) => item.trim()).filter(Boolean);
    }

    return (value ?? "")
        .split(/[\n,;]/)
        .map((item) => item.trim())
        .filter(Boolean);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function includesTerm(text: string, term: string): boolean {
    const normalizedText = normalizeTerm(text);
    const normalizedTerm = normalizeTerm(term);

    if (!normalizedTerm) return false;

    if (/^[a-z0-9+#. -]+$/i.test(normalizedTerm)) {
        return new RegExp(`(^|[^a-z0-9+#.])${escapeRegExp(normalizedTerm)}([^a-z0-9+#.]|$)`, "i")
            .test(normalizedText);
    }

    return normalizedText.includes(normalizedTerm);
}

function expandRoleTerms(roles: string[]): string[] {
    const expanded = new Set<string>();

    for (const role of roles) {
        const normalized = normalizeTerm(role);
        expanded.add(role);

        if (/front/.test(normalized)) {
            ROLE_ALIASES.frontend.forEach((alias) => expanded.add(alias));
        }

        if (/back/.test(normalized)) {
            ROLE_ALIASES.backend.forEach((alias) => expanded.add(alias));
        }

        if (/full/.test(normalized)) {
            ROLE_ALIASES.fullstack.forEach((alias) => expanded.add(alias));
        }
    }

    return [...expanded];
}

function jobText(job: SearchableJob): string {
    return [
        job.title,
        job.company ?? "",
        job.location ?? "",
        job.description,
    ].join(" ");
}

function matchesAny(text: string, terms: string[]): boolean {
    return terms.some((term) => includesTerm(text, term));
}

function postedAtWithinRange(postedAt: SearchableJob["postedAt"], dateRangeDays?: number): boolean {
    if (!dateRangeDays || !Number.isFinite(dateRangeDays) || dateRangeDays <= 0) return true;
    if (!postedAt) return true;

    const date = postedAt instanceof Date ? postedAt : new Date(postedAt);
    if (Number.isNaN(date.getTime())) return true;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - dateRangeDays);

    return date >= cutoff;
}

function matchesLocation(job: SearchableJob, locations: string[]): boolean {
    if (!locations.length) return true;
    if (!job.location) return true;

    const locationText = job.location;
    const allowsRemote = locations.some((location) => /remote/i.test(location));
    const isRemoteJob = /remote|hybrid/i.test(locationText);

    return matchesAny(locationText, locations) || (allowsRemote && isRemoteJob);
}

function hasDetailedDescription(job: SearchableJob): boolean {
    return job.description.trim().length >= 160;
}

export function filterJobsBySearchPreferences<T extends SearchableJob>(
    jobs: T[],
    preferences: SearchPreferences = {},
): { jobs: T[]; stats: SearchPreferenceFilterStats } {
    const targetRoles = expandRoleTerms(preferences.targetRoles ?? []);
    const targetLocations = preferences.targetLocations ?? [];
    const requiredTech = preferences.requiredTech ?? [];
    const excludedKeywords = preferences.excludedKeywords ?? [];
    const titleStopwords = preferences.excludedTitleKeywords ?? [];
    const stats: SearchPreferenceFilterStats = {
        input: jobs.length,
        output: 0,
        excludedKeyword: 0,
        titleStopword: 0,
        targetRole: 0,
        targetLocation: 0,
        requiredTech: 0,
        dateRange: 0,
    };
    const output: T[] = [];

    for (const job of jobs) {
        const text = jobText(job);

        if (excludedKeywords.length && matchesAny(text, excludedKeywords)) {
            stats.excludedKeyword++;
            continue;
        }

        // Hard filter: a title stopword hit (e.g. "Senior", "QA", "DevOps") is excluded
        // even if the job would otherwise match targetRoles/requiredTech.
        if (titleStopwords.length && matchesAny(job.title, titleStopwords)) {
            stats.titleStopword++;
            continue;
        }

        if (targetRoles.length && !matchesAny(text, targetRoles)) {
            stats.targetRole++;
            continue;
        }

        if (!matchesLocation(job, targetLocations)) {
            stats.targetLocation++;
            continue;
        }

        if (requiredTech.length && hasDetailedDescription(job) && !matchesAny(text, requiredTech)) {
            stats.requiredTech++;
            continue;
        }

        if (!postedAtWithinRange(job.postedAt, preferences.dateRangeDays)) {
            stats.dateRange++;
            continue;
        }

        output.push(job);
    }

    stats.output = output.length;

    return { jobs: output, stats };
}

export function normalizeSearchPreferences(input: SearchPreferences = {}): SearchPreferences {
    return {
        targetRoles: parsePreferenceTerms(input.targetRoles),
        targetLocations: parsePreferenceTerms(input.targetLocations),
        requiredTech: parsePreferenceTerms(input.requiredTech),
        excludedKeywords: parsePreferenceTerms(input.excludedKeywords),
        excludedTitleKeywords: parsePreferenceTerms(input.excludedTitleKeywords),
        dateRangeDays: Number.isFinite(Number(input.dateRangeDays)) && Number(input.dateRangeDays) > 0
            ? Number(input.dateRangeDays)
            : undefined,
        gmailScanDays: Number.isFinite(Number(input.gmailScanDays)) && Number(input.gmailScanDays) > 0
            ? Number(input.gmailScanDays)
            : undefined,
        minMatchScore: Number.isFinite(Number(input.minMatchScore))
            ? Math.max(0, Math.min(100, Number(input.minMatchScore)))
            : undefined,
    };
}
