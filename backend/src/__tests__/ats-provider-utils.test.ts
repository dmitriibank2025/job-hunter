import {
    parseNamedBoards,
    safeDate,
    stableExternalId,
    stripHtml,
} from "../providers/ats-provider-utils";
import { parseComeetAccounts } from "../providers/comeet.provider";

describe("ATS provider configuration", () => {
    it("parses named company boards and regions", () => {
        expect(parseNamedBoards("Acme|acme\nExample EU|example|eu;simple-board")).toEqual([
            { company: "Acme", key: "acme", region: "global" },
            { company: "Example EU", key: "example", region: "eu" },
            { company: "simple-board", key: "simple-board", region: "global" },
        ]);
    });

    it("ignores incomplete Comeet accounts", () => {
        expect(parseComeetAccounts("Acme|company-id|public-token;broken|entry")).toEqual([
            { company: "Acme", uid: "company-id", token: "public-token" },
        ]);
    });
});

describe("ATS provider normalization", () => {
    it("strips markup and decodes common entities", () => {
        expect(stripHtml("<h2>R&amp;D</h2><script>ignore()</script><p>Node.js&nbsp;&amp; React</p>"))
            .toBe("R&D Node.js & React");
    });

    it("normalizes ISO dates and unix timestamps", () => {
        expect(safeDate("2026-10-04T08:30:00.000Z")?.toISOString()).toBe("2026-10-04T08:30:00.000Z");
        expect(safeDate(1_759_566_600)?.toISOString()).toBe("2025-10-04T08:30:00.000Z");
        expect(safeDate("not-a-date")).toBeUndefined();
    });

    it("uses the posting path id when available and hashes opaque ids", () => {
        expect(stableExternalId("https://jobs.example.com/posting/abc12345?ref=home")).toBe("abc12345");
        expect(stableExternalId("opaque-job-key")).toMatch(/^[a-f0-9]{32}$/);
        expect(stableExternalId("opaque-job-key")).toBe(stableExternalId("opaque-job-key"));
    });
});
