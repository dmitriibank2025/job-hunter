import fs from "fs";
import path from "path";
import { classifyJobPage } from "../providers/job-page-classifier";
import { extractJobPostingFromHtml, hasJobPostingJsonLd } from "../providers/structured-job-extractor";
import { evaluateIsraelEligibility, scoreJobQuality, withJobQuality } from "../providers/job-quality";
import { detectAtsConfiguration } from "../services/ats-discovery.service";
import { isPublicBoardJobDetailUrl } from "../providers/public-job-board.provider";
import { isDrushimJobDetailUrl } from "../providers/drushim.provider";
import { isGotFriendsJobDetailUrl } from "../providers/gotfriends.provider";
import { isSqlinkJobDetailUrl } from "../providers/sqlink.provider";
import { filterJobsBySearchPreferences } from "../services/search-preferences.service";
import { parsePostedAt } from "../providers/browser-provider-utils";
import { isAllJobsJobDetailUrl } from "../providers/alljobs.provider";
import { stableExternalId } from "../providers/ats-provider-utils";
import { normalizeJobUrl } from "../services/job-deduplication.service";
import type { ParsedJob } from "../providers/types";

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "fixtures", "job-sources", name), "utf8");

function job(overrides: Partial<ParsedJob> = {}): ParsedJob {
    return {
        title: "Backend Engineer",
        company: "Example Labs",
        location: "Tel Aviv, Israel",
        url: "https://jobs.example.com/job/123456",
        source: "DEVJOBS",
        description: "Build production Node.js and TypeScript services on AWS with PostgreSQL. ".repeat(10),
        ...overrides,
    };
}

describe("job ingestion fixtures", () => {
    it("extracts a real JobPosting before DOM heuristics", () => {
        const parsed = extractJobPostingFromHtml(
            fixture("job-detail-jsonld.html"),
            "https://jobs.example.com/openings",
            "GREENHOUSE",
        );

        expect(parsed).toMatchObject({
            title: "Backend Engineer",
            company: "Example Labs",
            location: "Tel Aviv, Israel",
            url: "https://jobs.example.com/jobs/backend-engineer-123456",
            applyUrl: "https://jobs.example.com/jobs/backend-engineer-123456",
            externalJobId: "123456",
            employmentType: "FULL_TIME, HYBRID",
        });
        expect(parsed?.ingestion?.extractionMethod).toBe("json_ld");
        expect(parsed?.postedAt?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    });

    it("ignores malformed structured data instead of inventing fields", () => {
        const html = fixture("malformed-jsonld.html");
        expect(hasJobPostingJsonLd(html)).toBe(false);
        expect(extractJobPostingFromHtml(html, "https://example.com/jobs", "DEVJOBS")).toBeNull();
    });

    it("preserves remote applicant restrictions and never invents an application link", () => {
        const html = `<script type="application/ld+json">${JSON.stringify({
            "@type": "JobPosting",
            title: "Backend Engineer",
            description: "Build services with Node.js and TypeScript. ".repeat(15),
            jobLocationType: "TELECOMMUTE",
            applicantLocationRequirements: { "@type": "Country", name: "Poland" },
            jobLocation: { address: { addressLocality: "Tel Aviv", addressCountry: { name: "Israel" } } },
        })}</script>`;
        const parsed = extractJobPostingFromHtml(html, "https://example.com/job/123456", "DEVJOBS");
        expect(parsed?.location).toBe("Remote - Poland");
        expect(parsed?.applyUrl).toBeUndefined();
        expect(parsed?.ingestion?.fieldConfidence?.applyUrl).toBe(0);
        expect(withJobQuality(parsed!).ingestion?.qualityState).toBe("REJECTED");
    });

    it("keeps all published locations, including object-form countries", () => {
        const html = `<script type="application/ld+json">${JSON.stringify({
            "@type": "JobPosting",
            title: "Backend Engineer",
            description: "Build services with Node.js and TypeScript. ".repeat(15),
            jobLocation: [
                { address: { addressLocality: "Tel Aviv", addressCountry: { name: "Israel" } } },
                { address: { addressLocality: "Berlin", addressCountry: { name: "Germany" } } },
            ],
        })}</script>`;
        expect(extractJobPostingFromHtml(html, "https://example.com/job/123456", "DEVJOBS")?.location)
            .toBe("Tel Aviv, Israel; Berlin, Germany");
    });
});

describe("job page classification", () => {
    it.each([
        ["search_results", "https://example.com/jobs/search?keywords=node"],
        ["category", "https://www.gotfriends.co.il/jobslobby/software/backend-developer/"],
        ["company_page", "https://example.com/company/careers"],
        ["apply_page", "https://example.com/jobs/123/apply"],
    ])("classifies %s pages", (expected, url) => {
        expect(classifyJobPage({ url }).classification).toBe(expected);
    });

    it("accepts a detail page only when multiple detail signals agree", () => {
        expect(classifyJobPage({
            url: "https://example.com/job/123456/backend-engineer",
            hasUniqueJobId: true,
            hasTitleHeading: true,
            hasApplyCta: true,
            descriptionLength: 800,
        }).classification).toBe("job_detail");
    });

    it("recognizes GotFriends terminal numeric pages as details", () => {
        const result = classifyJobPage({
            url: "https://www.gotfriends.co.il/jobslobby/software/full-stack-developer/155101/",
            hasUniqueJobId: true,
        });
        expect(result.classification).toBe("job_detail");
        expect(result.reasons).toContain("JOB_DETAIL_URL_PATTERN");
    });

    it("recognizes SQLink numeric career details rather than categories", () => {
        const result = classifyJobPage({
            url: "https://www.sqlink.com/career/job/position-123456/",
            hasUniqueJobId: true,
        });
        expect(result.classification).toBe("job_detail");
    });
});

describe("source-specific detail URL contracts", () => {
    it("keeps query-based vacancy IDs distinct while rejecting AllJobs articles", () => {
        const first = "https://www.alljobs.co.il/Search/UploadSingle.aspx?JobID=123456&utm_source=feed";
        const second = "https://www.alljobs.co.il/Search/UploadSingle.aspx?JobID=654321";
        expect(isAllJobsJobDetailUrl(first)).toBe(true);
        expect(isAllJobsJobDetailUrl("https://www.alljobs.co.il/ArticlePage.aspx?LinkWord=found_job")).toBe(false);
        expect(stableExternalId(first)).toBe("123456");
        expect(normalizeJobUrl(first)).not.toBe(normalizeJobUrl(second));
        expect(normalizeJobUrl("https://www.jobmaster.co.il/jobs/checknum.asp?key=111111"))
            .not.toBe(normalizeJobUrl("https://www.jobmaster.co.il/jobs/checknum.asp?key=222222"));
    });
    it.each([
        ["Drushim", isDrushimJobDetailUrl, "https://www.drushim.co.il/job/38512345/abc123/", "https://www.drushim.co.il/jobs/search/backend/"],
        ["GotFriends", isGotFriendsJobDetailUrl, "https://www.gotfriends.co.il/jobslobby/ai/ai-engineer/118511/", "https://www.gotfriends.co.il/jobslobby/ai/ai-engineer/"],
        ["SQLink", isSqlinkJobDetailUrl, "https://www.sqlink.com/career/job/position-123456/", "https://www.sqlink.com/career/software/webmobile/"],
    ])("%s accepts detail URLs and rejects discovery pages", (_name, check, detail, discovery) => {
        expect(check(detail)).toBe(true);
        expect(check(discovery)).toBe(false);
    });

    it("accepts GotFriends variant job IDs", () => {
        expect(isGotFriendsJobDetailUrl("https://www.gotfriends.co.il/jobslobby/software/backend-developer/155022-1/")).toBe(true);
    });

    it.each([
        ["DEVJOBS", "https://devjobs.co.il/job-details/12345", "https://devjobs.co.il/jobs-grid"],
        ["JOBMASTER", "https://www.jobmaster.co.il/jobs/checknum.asp?key=123456", "https://www.jobmaster.co.il/jobs/q-Backend-Developer/"],
        ["NISHA", "https://www.nisha.co.il/job/12749/", "https://www.nisha.co.il/positions/backend-engineer/"],
        ["JOBIFY", "https://jobify.run/jobs/backend-engineer-12345", "https://jobify.run/tech/typescript-developer-jobs"],
        ["EMPLOYBL", "https://www.employbl.com/jobs/backend-engineer-12345", "https://www.employbl.com/job-listings"],
        ["ETHOSIA", "https://ethosia.co.il/jobs/backend-engineer-12345", "https://ethosia.co.il/jobs"],
    ] as const)("%s uses a source-specific URL contract", (source, detail, discovery) => {
        expect(isPublicBoardJobDetailUrl(source, detail)).toBe(true);
        expect(isPublicBoardJobDetailUrl(source, discovery)).toBe(false);
    });
});

describe("ATS discovery", () => {
    it.each([
        ["greenhouse", "https://job-boards.greenhouse.io/innovid", "innovid"],
        ["lever", "https://jobs.lever.co/example", "example"],
        ["ashby", "https://jobs.ashbyhq.com/example", "example"],
        ["comeet", "https://www.comeet.com/jobs/example/", "example"],
        ["workable", "https://apply.workable.com/example/", "example"],
    ])("detects %s from the career URL", (ats, url, slug) => {
        expect(detectAtsConfiguration(url)).toMatchObject({ ats, accountSlug: slug });
    });
});

describe("quality, geography, and transparent optional fields", () => {
    it("parses Israeli day-first publication dates deterministically", () => {
        expect(parsePostedAt("24/09/2026")?.toISOString()).toBe("2026-09-24T00:00:00.000Z");
    });

    it("does not let an Israel mention in the description override explicit Poland", () => {
        expect(evaluateIsraelEligibility(job({
            location: "Remote - Poland",
            description: "The company also has customers in Israel.",
        }))).toEqual({ eligibility: "INELIGIBLE", reason: "REMOTE_EXPLICIT_FOREIGN_COUNTRY" });
    });

    it("rejects explicitly foreign locations before persistence", () => {
        expect(withJobQuality(job({ location: "Remote - Poland" })).ingestion?.qualityState).toBe("REJECTED");
        expect(evaluateIsraelEligibility(job({ location: "IL" })).eligibility).toBe("ELIGIBLE");
        expect(evaluateIsraelEligibility(job({ location: 'ת"א והמרכז' })).eligibility).toBe("ELIGIBLE");
    });

    it("keeps missing optional fields as needs-enrichment instead of fabricating them", () => {
        const evaluated = withJobQuality(job({ company: undefined, location: undefined, postedAt: undefined }));
        expect(evaluated.company).toBeUndefined();
        expect(evaluated.location).toBeUndefined();
        expect(evaluated.ingestion?.qualityState).toBe("NEEDS_ENRICHMENT");
        expect(evaluated.ingestion?.locationEligibility).toBe("NEEDS_VERIFICATION");
    });

    it("never treats the source name as a real company", () => {
        expect(scoreJobQuality(job({ company: "DEVJOBS" })).score)
            .toBeLessThan(scoreJobQuality(job()).score);
    });

    it("rejects a Data Engineer title even when its body mentions backend work", () => {
        const result = filterJobsBySearchPreferences([
            job({ title: "Data Engineer", description: "Build backend data pipelines with Node.js and TypeScript." }),
        ], { targetRoles: ["Backend Developer"] });
        expect(result.jobs).toHaveLength(0);
        expect(result.decisions[0].final).toBe("ROLE_MISMATCH");
    });

    it("reports unknown date and location instead of silently asserting they matched", () => {
        const result = filterJobsBySearchPreferences([
            job({ location: undefined, postedAt: undefined }),
        ], { targetRoles: ["Backend Developer"], targetLocations: ["Israel"], dateRangeDays: 14 });
        expect(result.jobs).toHaveLength(1);
        expect(result.decisions[0].checks).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: "targetLocation", status: "UNKNOWN" }),
            expect.objectContaining({ name: "publishedAt", status: "UNKNOWN" }),
        ]));
    });
});
