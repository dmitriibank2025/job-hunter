import { Job } from "@prisma/client";
import { prisma } from "../infrastructure/prisma";
import { createJobIfNew, normalizeJobUrl, inferExternalJobId } from "../services/job-deduplication.service";

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

describe("duplicate enrichment", () => {
    afterEach(() => jest.restoreAllMocks());

    it("backfills verified ingestion fields without replacing a longer saved description", async () => {
        const existing = {
            id: "saved-job",
            title: "Backend Engineer",
            company: null,
            location: null,
            url: "https://example.com/job/123456",
            normalizedUrl: null,
            fingerprint: null,
            externalJobId: null,
            postedAt: null,
            applyUrl: null,
            employmentType: null,
            description: "Existing verified description ".repeat(30),
            ingestionQualityScore: null,
            ingestionQualityState: null,
            ingestionMetadata: null,
            source: "DEVJOBS",
        } as unknown as Job;
        jest.spyOn(prisma.job, "findFirst").mockResolvedValue(existing);
        jest.spyOn(prisma.resumeVersion, "count").mockResolvedValue(0);
        const update = jest.spyOn(prisma.job, "update").mockResolvedValue({ ...existing, company: "Example Labs" });

        const result = await createJobIfNew({
            title: "Backend Engineer",
            company: "Example Labs",
            location: "Tel Aviv, Israel",
            url: existing.url!,
            description: "Short new description",
            source: "DEVJOBS",
            applyUrl: "https://example.com/apply/123456",
            employmentType: "FULL_TIME",
            ingestion: { qualityScore: 85, qualityState: "HIGH_CONFIDENCE", extractionMethod: "json_ld" },
        });

        expect(result.isNew).toBe(false);
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                company: "Example Labs",
                location: "Tel Aviv, Israel",
                applyUrl: "https://example.com/apply/123456",
                employmentType: "FULL_TIME",
                ingestionQualityScore: 85,
            }),
        }));
        expect(update.mock.calls[0][0].data).not.toHaveProperty("description");
    });
});
