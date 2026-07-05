import { normalizeSearchPreferences, filterJobsBySearchPreferences } from "../services/search-preferences.service";

const makeJob = (overrides = {}) => ({
    title: "Senior Node.js Developer",
    company: "Acme",
    location: "Tel Aviv",
    description: "We need a Node.js developer with TypeScript and AWS experience.",
    postedAt: new Date(),
    ...overrides,
});

describe("normalizeSearchPreferences", () => {
    it("returns empty arrays and undefined numerics for empty input", () => {
        const result = normalizeSearchPreferences({});
        expect(Array.isArray(result.targetRoles)).toBe(true);
        expect(result.dateRangeDays).toBeUndefined();
        expect(result.minMatchScore).toBeUndefined();
    });

    it("clamps minMatchScore to 0–100", () => {
        expect(normalizeSearchPreferences({ minMatchScore: 150 }).minMatchScore).toBe(100);
        expect(normalizeSearchPreferences({ minMatchScore: -10 }).minMatchScore).toBe(0);
        expect(normalizeSearchPreferences({ minMatchScore: 75 }).minMatchScore).toBe(75);
    });

    it("ignores non-positive dateRangeDays", () => {
        expect(normalizeSearchPreferences({ dateRangeDays: 0 }).dateRangeDays).toBeUndefined();
        expect(normalizeSearchPreferences({ dateRangeDays: -1 }).dateRangeDays).toBeUndefined();
    });

    it("parses valid dateRangeDays", () => {
        expect(normalizeSearchPreferences({ dateRangeDays: 7 }).dateRangeDays).toBe(7);
    });
});

describe("filterJobsBySearchPreferences", () => {
    it("returns all jobs when no preferences set", () => {
        const jobs = [makeJob(), makeJob({ title: "Frontend Dev" })];
        const { jobs: result } = filterJobsBySearchPreferences(jobs, {});
        expect(result).toHaveLength(2);
    });

    it("filters out jobs with excluded keywords in title", () => {
        const jobs = [
            makeJob({ title: "PHP Developer" }),
            makeJob({ title: "Node.js Developer" }),
        ];
        const { jobs: result } = filterJobsBySearchPreferences(jobs, {
            excludedKeywords: ["PHP"],
        });
        expect(result).toHaveLength(1);
        expect(result[0].title).toContain("Node.js");
    });

    it("filters out jobs older than dateRangeDays", () => {
        const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
        const jobs = [
            makeJob({ postedAt: oldDate }),
            makeJob({ postedAt: new Date() }),
        ];
        const { jobs: result } = filterJobsBySearchPreferences(jobs, { dateRangeDays: 7 });
        expect(result).toHaveLength(1);
    });

    it("tracks filter stats", () => {
        const jobs = [
            makeJob({ title: "PHP Developer" }),
            makeJob({ title: "Node.js Developer" }),
        ];
        const { stats } = filterJobsBySearchPreferences(jobs, { excludedKeywords: ["PHP"] });
        expect(stats.input).toBe(2);
        expect(stats.output).toBe(1);
        expect(stats.excludedKeyword).toBeGreaterThan(0);
    });

    it("does not filter by title stopwords when excludedTitleKeywords is not set", () => {
        const jobs = [makeJob({ title: "Senior Node.js Developer" })];
        const { jobs: result } = filterJobsBySearchPreferences(jobs, {});
        expect(result).toHaveLength(1);
    });

    it("hard-filters jobs matching excludedTitleKeywords in the title, even if targetRoles matches", () => {
        const jobs = [
            makeJob({ title: "Senior Node.js Developer" }),
            makeJob({ title: "QA Automation Engineer", description: "Node.js and TypeScript testing framework." }),
            makeJob({ title: "Node.js Developer" }),
        ];
        const { jobs: result, stats } = filterJobsBySearchPreferences(jobs, {
            targetRoles: ["developer"],
            excludedTitleKeywords: ["senior", "qa"],
        });
        expect(result).toHaveLength(1);
        expect(result[0].title).toBe("Node.js Developer");
        expect(stats.titleStopword).toBe(2);
    });

    it("does not apply title stopwords against the description", () => {
        const jobs = [
            makeJob({
                title: "Node.js Developer",
                description: "You will collaborate closely with our QA and DevOps teams.",
            }),
        ];
        const { jobs: result } = filterJobsBySearchPreferences(jobs, {
            excludedTitleKeywords: ["qa", "devops"],
        });
        expect(result).toHaveLength(1);
    });
});
