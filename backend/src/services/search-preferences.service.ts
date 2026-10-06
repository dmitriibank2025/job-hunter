export type SearchPreferences = {
    targetRoles?: string[];
    targetLocations?: string[];
    requiredTech?: string[];
    excludedKeywords?: string[];
    excludedTitleKeywords?: string[];
    excludedCompanies?: string[];
    excludeRemote?: boolean;
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
    excludedCompany: number;
    remote: number;
    targetRole: number;
    targetLocation: number;
    requiredTech: number;
    dateRange: number;
};

export type JobFilterCheck = {
    name: "excludedKeywords" | "titleStopword" | "companyBlacklist" | "remote" | "targetRole" |
    "targetLocation" | "requiredTech" | "publishedAt";
    status: "PASS" | "FAIL" | "UNKNOWN";
    reason: string;
};

export type JobFilterDecision<T extends SearchableJob = SearchableJob> = {
    job: T;
    checks: JobFilterCheck[];
    final: "PASS" | "EXCLUDED_KEYWORD" | "TITLE_STOPWORD" | "BLACKLISTED_COMPANY" | "REMOTE_EXCLUDED" |
    "ROLE_MISMATCH" | "LOCATION_MISMATCH" | "TECH_MISMATCH" | "OUTSIDE_DATE_RANGE";
};

const ROLE_ALIASES: Record<string, string[]> = {
    frontend: ["frontend", "front-end", "front end", "react", "ui developer", "web developer", "מפתח פרונטאנד", "מפתחת פרונטאנד"],
    backend: ["backend", "back-end", "back end", "node.js", "nodejs", "server-side", "api developer", "מפתח בקאנד", "מפתחת בקאנד"],
    fullstack: ["fullstack", "full-stack", "full stack", "full-stack developer", "full stack developer", "פול סטאק", "פולסטאק"],
    software: ["software engineer", "software developer", "software development engineer", "software dev engineer", "מהנדס תוכנה", "מפתח תוכנה"],
    ai: ["ai engineer", "ai software engineer", "applied ai engineer", "llm engineer", "machine learning engineer", "generative ai engineer"],
};

const ISRAEL_LOCATION_TERMS = [
    "israel", "tel aviv", "tel-aviv", "tel aviv-yafo", "ramat gan", "herzliya", "petah tikva",
    "rishon lezion", "rishon le zion", "rehovot", "ra'anana", "raanana", "jerusalem", "haifa",
    "netanya", "central district", "center district", "ישראל", "תל אביב", "רמת גן", "הרצליה",
    "פתח תקווה", "ראשון לציון", "רחובות", "רעננה", "ירושלים", "חיפה", "נתניה",
];

const EXPLICIT_FOREIGN_LOCATION_TERMS = [
    "poland", "romania", "bucharest", "germany", "berlin", "munich", "france", "paris", "spain", "italy", "portugal", "united kingdom",
    "london", "united states", "usa", "new york", "san francisco", "boston", "chicago", "austin", "seattle", "california",
    "massachusetts", "texas", "canada", "toronto", "vancouver", "india", "australia", "singapore", "netherlands", "sweden",
    "denmark", "ireland", "czech", "hungary", "ukraine", "greece", "colombia", "south korea", "bulgaria", "mexico",
    "brazil", "argentina", "chile", "united arab emirates", "japan", "china", "philippines", "south africa", "turkey",
    "belgium", "austria", "switzerland", "norway", "finland", "estonia", "latvia", "lithuania", "croatia", "serbia",
];

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

// Normalize a company name for blacklist matching: drop common legal/entity
// suffixes and punctuation so "Hire Feed", "HireFeed Ltd." and "hire feed"
// all collapse to the same key. Kept in sync with the blacklist service.
export function normalizeCompanyName(value?: string | null): string {
    return (value ?? "")
        .replace(/\b(israel|ltd|limited|inc|corp|corporation|technologies|technology|staffing|recruiting|recruitment)\b/gi, "")
        .replace(/[^a-z0-9]+/gi, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

function isBlacklistedCompany(company: string | null | undefined, blacklist: string[]): boolean {
    if (!blacklist.length) return false;
    const normalizedCompany = normalizeCompanyName(company);
    if (!normalizedCompany) return false;
    // Also compare with all whitespace removed so "HireFeed" and "Hire Feed"
    // collapse to the same token.
    const compactCompany = normalizedCompany.replace(/\s+/g, "");

    return blacklist.some((entry) => {
        const normalizedEntry = normalizeCompanyName(entry);
        if (!normalizedEntry) return false;
        const compactEntry = normalizedEntry.replace(/\s+/g, "");
        // Match on containment (either direction) so "Hire Feed" also catches
        // "Hire Feed Global", "HireFeed Ltd.", etc.
        return compactCompany.includes(compactEntry) || compactEntry.includes(compactCompany);
    });
}

function isRemoteJob(job: SearchableJob): boolean {
    const location = normalizeTerm(job.location ?? "");
    if (/\bremote\b/.test(location)) return true;
    // Titles frequently carry "(Remote)" when the location field is generic.
    return /\bfully remote\b|\b100% remote\b|\bremote\b/.test(normalizeTerm(job.title));
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

        if (/software/.test(normalized)) {
            ROLE_ALIASES.software.forEach((alias) => expanded.add(alias));
        }

        if (/\bai\b|llm|machine learning/.test(normalized)) {
            ROLE_ALIASES.ai.forEach((alias) => expanded.add(alias));
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

function matchesTargetRole(job: SearchableJob, terms: string[]): boolean {
    if (!terms.length) return true;
    if (matchesAny(job.title, terms)) return true;

    // A genuinely generic title may require the description to identify the specialization.
    // Specific families such as Data Engineer must not pass merely because the body mentions backend work.
    if (/^(?:junior |mid(?:-level)? |senior |sr\.? )?(?:software )?(?:engineer|developer)(?: [ivx]+)?$/i.test(job.title.trim())) {
        return matchesAny(jobText(job), terms);
    }

    return false;
}

function locationEvaluation(job: SearchableJob, locations: string[]): { matches: boolean; unknown: boolean; reason: string } {
    if (!locations.length) return { matches: true, unknown: false, reason: "NO_LOCATION_FILTER" };
    if (!job.location?.trim()) return { matches: true, unknown: true, reason: "MISSING_LOCATION" };

    const locationText = job.location;
    const allowsRemote = locations.some((location) => /remote/i.test(location));
    const isRemoteJob = /\bremote\b/i.test(locationText);
    const hasIsraelSignal = matchesAny(locationText, ISRAEL_LOCATION_TERMS);
    const hasForeignSignal = matchesAny(locationText, EXPLICIT_FOREIGN_LOCATION_TERMS);
    const targetsIsrael = locations.some((location) => /israel|tel aviv|ramat gan|herzliya|petah tikva|jerusalem|haifa|netanya/i.test(location));

    if (hasIsraelSignal && targetsIsrael) return { matches: true, unknown: false, reason: "ISRAEL_LOCATION_SIGNAL" };
    if (isRemoteJob && hasForeignSignal && !hasIsraelSignal) {
        return { matches: false, unknown: false, reason: "REMOTE_EXPLICIT_FOREIGN_COUNTRY" };
    }
    if (matchesAny(locationText, locations)) return { matches: true, unknown: false, reason: "TARGET_LOCATION_MATCH" };
    if (allowsRemote && isRemoteJob) return { matches: true, unknown: true, reason: "REMOTE_WITHOUT_ELIGIBLE_COUNTRY" };

    return { matches: false, unknown: false, reason: "NO_TARGET_LOCATION_SIGNAL" };
}

function hasDetailedDescription(job: SearchableJob): boolean {
    return job.description.trim().length >= 160;
}

export function filterJobsBySearchPreferences<T extends SearchableJob>(
    jobs: T[],
    preferences: SearchPreferences = {},
): { jobs: T[]; stats: SearchPreferenceFilterStats; decisions: JobFilterDecision<T>[] } {
    const targetRoles = expandRoleTerms(preferences.targetRoles ?? []);
    const targetLocations = preferences.targetLocations ?? [];
    const requiredTech = preferences.requiredTech ?? [];
    const excludedKeywords = preferences.excludedKeywords ?? [];
    const titleStopwords = preferences.excludedTitleKeywords ?? [];
    const excludedCompanies = preferences.excludedCompanies ?? [];
    const excludeRemote = Boolean(preferences.excludeRemote);
    const stats: SearchPreferenceFilterStats = {
        input: jobs.length,
        output: 0,
        excludedKeyword: 0,
        titleStopword: 0,
        excludedCompany: 0,
        remote: 0,
        targetRole: 0,
        targetLocation: 0,
        requiredTech: 0,
        dateRange: 0,
    };
    const output: T[] = [];
    const decisions: JobFilterDecision<T>[] = [];

    for (const job of jobs) {
        const text = jobText(job);
        const checks: JobFilterCheck[] = [];
        const finish = (final: JobFilterDecision<T>["final"]) => {
            decisions.push({ job, checks, final });
        };

        if (excludedKeywords.length && matchesAny(text, excludedKeywords)) {
            checks.push({ name: "excludedKeywords", status: "FAIL", reason: "EXCLUDED_KEYWORD_MATCH" });
            stats.excludedKeyword++;
            finish("EXCLUDED_KEYWORD");
            continue;
        }
        checks.push({ name: "excludedKeywords", status: "PASS", reason: "NO_EXCLUDED_KEYWORD" });

        // Hard filter: a title stopword hit (e.g. "Senior", "QA", "DevOps") is excluded
        // even if the job would otherwise match targetRoles/requiredTech.
        if (titleStopwords.length && matchesAny(job.title, titleStopwords)) {
            checks.push({ name: "titleStopword", status: "FAIL", reason: "TITLE_STOPWORD_MATCH" });
            stats.titleStopword++;
            finish("TITLE_STOPWORD");
            continue;
        }
        checks.push({ name: "titleStopword", status: "PASS", reason: "NO_TITLE_STOPWORD" });

        // Blacklisted companies (e.g. staffing spam like "Hired", "Hire Feed") are
        // dropped before anything else — never analyzed, never turned into a resume.
        if (isBlacklistedCompany(job.company, excludedCompanies)) {
            checks.push({ name: "companyBlacklist", status: "FAIL", reason: "BLACKLISTED_COMPANY" });
            stats.excludedCompany++;
            finish("BLACKLISTED_COMPANY");
            continue;
        }
        checks.push({
            name: "companyBlacklist",
            status: job.company ? "PASS" : "UNKNOWN",
            reason: job.company ? "COMPANY_NOT_BLACKLISTED" : "MISSING_COMPANY",
        });

        if (excludeRemote && isRemoteJob(job)) {
            checks.push({ name: "remote", status: "FAIL", reason: "REMOTE_EXCLUDED" });
            stats.remote++;
            finish("REMOTE_EXCLUDED");
            continue;
        }
        checks.push({ name: "remote", status: "PASS", reason: "REMOTE_POLICY_PASS" });

        if (!matchesTargetRole(job, targetRoles)) {
            checks.push({ name: "targetRole", status: "FAIL", reason: "TITLE_ROLE_MISMATCH" });
            stats.targetRole++;
            finish("ROLE_MISMATCH");
            continue;
        }
        checks.push({ name: "targetRole", status: "PASS", reason: "TITLE_ROLE_MATCH" });

        const location = locationEvaluation(job, targetLocations);
        if (!location.matches) {
            checks.push({ name: "targetLocation", status: "FAIL", reason: location.reason });
            stats.targetLocation++;
            finish("LOCATION_MISMATCH");
            continue;
        }
        checks.push({ name: "targetLocation", status: location.unknown ? "UNKNOWN" : "PASS", reason: location.reason });

        if (requiredTech.length && hasDetailedDescription(job) && !matchesAny(text, requiredTech)) {
            checks.push({ name: "requiredTech", status: "FAIL", reason: "REQUIRED_TECH_NOT_FOUND" });
            stats.requiredTech++;
            finish("TECH_MISMATCH");
            continue;
        }
        checks.push({
            name: "requiredTech",
            status: requiredTech.length && !hasDetailedDescription(job) ? "UNKNOWN" : "PASS",
            reason: requiredTech.length && !hasDetailedDescription(job) ? "DESCRIPTION_TOO_SHORT_TO_VERIFY" : "TECH_POLICY_PASS",
        });

        if (!postedAtWithinRange(job.postedAt, preferences.dateRangeDays)) {
            checks.push({ name: "publishedAt", status: "FAIL", reason: "OUTSIDE_DATE_RANGE" });
            stats.dateRange++;
            finish("OUTSIDE_DATE_RANGE");
            continue;
        }
        checks.push({
            name: "publishedAt",
            status: job.postedAt ? "PASS" : "UNKNOWN",
            reason: job.postedAt ? "WITHIN_DATE_RANGE" : "MISSING_PUBLISHED_AT",
        });

        output.push(job);
        finish("PASS");
    }

    stats.output = output.length;

    return { jobs: output, stats, decisions };
}

export function formatFilterDecision(decision: JobFilterDecision): string {
    const lines = [
        `Job: ${decision.job.title}`,
        `Company: ${decision.job.company ?? "UNKNOWN"}`,
        ...decision.checks.map((check) => `${check.status} ${check.name}: ${check.reason}`),
        `Final: ${decision.final}`,
    ];
    return lines.join("\n");
}

export function normalizeSearchPreferences(input: SearchPreferences = {}): SearchPreferences {
    return {
        targetRoles: parsePreferenceTerms(input.targetRoles),
        targetLocations: parsePreferenceTerms(input.targetLocations),
        requiredTech: parsePreferenceTerms(input.requiredTech),
        excludedKeywords: parsePreferenceTerms(input.excludedKeywords),
        excludedTitleKeywords: parsePreferenceTerms(input.excludedTitleKeywords),
        excludedCompanies: parsePreferenceTerms(input.excludedCompanies),
        excludeRemote: Boolean(input.excludeRemote),
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
