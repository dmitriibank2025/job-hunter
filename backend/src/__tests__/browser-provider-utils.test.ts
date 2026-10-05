import {
    defaultProviderBrowserTimeoutMs,
    filterRelevantJobs,
} from "../providers/browser-provider-utils";

describe("browser provider safeguards", () => {
    const originalBrowserTimeout = process.env.PROVIDER_BROWSER_TIMEOUT_MS;
    const originalProviderTimeout = process.env.PROVIDER_TIMEOUT_MS;

    afterEach(() => {
        if (originalBrowserTimeout === undefined) delete process.env.PROVIDER_BROWSER_TIMEOUT_MS;
        else process.env.PROVIDER_BROWSER_TIMEOUT_MS = originalBrowserTimeout;

        if (originalProviderTimeout === undefined) delete process.env.PROVIDER_TIMEOUT_MS;
        else process.env.PROVIDER_TIMEOUT_MS = originalProviderTimeout;
    });

    it("keeps the browser alive beyond the collector provider deadline", () => {
        process.env.PROVIDER_BROWSER_TIMEOUT_MS = "120000";
        process.env.PROVIDER_TIMEOUT_MS = "150000";

        expect(defaultProviderBrowserTimeoutMs()).toBe(210000);
    });

    it("rejects navigation links that resemble job cards", () => {
        expect(filterRelevantJobs([{
            title: "Jobs by title",
            company: "Employbl",
            location: "Remote",
            url: "https://www.employbl.com/job-listings/jobs/by-title",
            source: "EMPLOYBL" as const,
            description: "Browse software engineer, frontend, backend, React and Node.js jobs.",
        }])).toEqual([]);
    });
});
