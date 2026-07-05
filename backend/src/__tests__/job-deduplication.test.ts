import { normalizeJobUrl, inferExternalJobId } from "../services/job-deduplication.service";

describe("normalizeJobUrl", () => {
    it("removes trailing slash", () => {
        expect(normalizeJobUrl("https://example.com/jobs/123/")).toBe("https://example.com/jobs/123");
    });

    it("strips query params and hash", () => {
        expect(normalizeJobUrl("https://example.com/jobs/123?ref=google#top")).toBe(
            "https://example.com/jobs/123",
        );
    });

    it("strips www prefix", () => {
        expect(normalizeJobUrl("https://www.linkedin.com/jobs/view/123")).toBe(
            "https://linkedin.com/jobs/view/123",
        );
    });

    it("lowercases hostname", () => {
        expect(normalizeJobUrl("https://JOBS.Example.com/position/5")).toBe(
            "https://jobs.example.com/position/5",
        );
    });

    it("returns null for empty input", () => {
        expect(normalizeJobUrl(null)).toBeNull();
        expect(normalizeJobUrl("")).toBeNull();
        expect(normalizeJobUrl(undefined)).toBeNull();
    });

    it("handles invalid URL gracefully", () => {
        const result = normalizeJobUrl("not-a-url");
        expect(typeof result).toBe("string");
    });
});

describe("inferExternalJobId", () => {
    it("extracts LinkedIn job ID from URL path", () => {
        expect(inferExternalJobId("https://linkedin.com/jobs/view/frontend-developer-4234567890", "LINKEDIN")).toBe(
            "4234567890",
        );
    });

    it("extracts job ID from currentJobId query param", () => {
        expect(inferExternalJobId("https://example.com/jobs?currentJobId=9876543")).toBe("9876543");
    });

    it("extracts Greenhouse job ID", () => {
        expect(inferExternalJobId("https://boards.greenhouse.io/company/jobs/12345678", "GREENHOUSE")).toBe(
            "12345678",
        );
    });

    it("extracts UUID from path", () => {
        const uuid = "550e8400-e29b-41d4-a716-446655440000";
        expect(inferExternalJobId(`https://example.com/jobs/${uuid}`)).toBe(uuid);
    });

    it("returns null for non-job URLs", () => {
        expect(inferExternalJobId("https://example.com/about")).toBeNull();
    });

    it("returns null for null input", () => {
        expect(inferExternalJobId(null)).toBeNull();
        expect(inferExternalJobId(undefined)).toBeNull();
    });
});
