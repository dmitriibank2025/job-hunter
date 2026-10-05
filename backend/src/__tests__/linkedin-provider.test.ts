jest.mock("../infrastructure/prisma", () => ({ prisma: {} }));
import { linkedInTimeFilter, linkedInSearchUrls, nextEmptyPageCount, parseLinkedInPostedAt, isLinkedInJobWithinRange } from "../providers/linkedin.provider";

describe("LinkedIn search regression", () => {
    test.each([1, 7, 14, 30, 60])("preserves exact %i day window", days => {
        expect(linkedInTimeFilter({ dateRangeDays: days })).toBe(`r${days * 86400}`);
    });
    test("date-limited search excludes unfiltered collections and applies window to all URLs", () => {
        const urls = linkedInSearchUrls({ dateRangeDays: 14, targetRoles: ["Frontend Developer"] });
        expect(urls.length).toBeGreaterThan(0);
        for (const value of urls) {
            const url = new URL(value);
            expect(url.pathname).not.toContain("collections");
            expect(url.searchParams.get("f_TPR")).toBe("r1209600");
        }
    });
    test("an existing-only page is not empty", () => {
        expect(nextEmptyPageCount(25, 1)).toBe(0);
        expect(nextEmptyPageCount(0, 1)).toBe(2);
    });
    const now = Date.parse("2026-10-04T12:00:00Z");
    test.each(["4 days ago", "‏לאחרונה לפני ‏4‏ ‏ימים‏"])("parses relative date: %s", value => {
        expect(parseLinkedInPostedAt(value, now)?.toISOString()).toBe("2026-09-30T12:00:00.000Z");
    });
    test("rejects unknown, invalid, future and old dates for a bounded search", () => {
        for (const date of [undefined, new Date("bad"), new Date(now + 86400000), new Date(now - 15 * 86400000)]) {
            expect(isLinkedInJobWithinRange(date, 14, now)).toBe(false);
        }
        expect(isLinkedInJobWithinRange(new Date(now - 13 * 86400000), 14, now)).toBe(true);
        expect(parseLinkedInPostedAt("Saved", now)).toBeUndefined();
        expect(isLinkedInJobWithinRange(undefined)).toBe(true);
    });
});
