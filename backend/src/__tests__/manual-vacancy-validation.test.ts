import { manualVacancySchema } from "../validation/api.schemas";
import { normalizeManualUrl, selectManualDescription } from "../services/manual-vacancy.service";

describe("manual vacancy validation", () => {
    it("treats blank optional form fields as absent", () => {
        const parsed = manualVacancySchema.parse({
            url: " ",
            title: "",
            company: "  ",
            location: "",
            externalJobId: "",
            description: "A complete vacancy description with enough useful content for manual processing.",
        });

        expect(parsed).toEqual({
            url: undefined,
            title: undefined,
            company: undefined,
            location: undefined,
            externalJobId: undefined,
            description: "A complete vacancy description with enough useful content for manual processing.",
        });
    });

    it("still requires a URL or at least 50 characters of text", () => {
        expect(() => manualVacancySchema.parse({ description: "Too short" })).toThrow(
            "Provide either a vacancy URL or at least 50 characters of vacancy text.",
        );
    });

    it("uses extracted text when the manually entered fragment is too short", () => {
        const extracted = "A complete extracted vacancy description that is comfortably longer than fifty characters.";
        expect(selectManualDescription("short fragment", extracted)).toBe(extracted);
    });

    it("prefers a complete user-provided description", () => {
        const provided = "A complete user-provided vacancy description that is comfortably longer than fifty characters.";
        expect(selectManualDescription(provided, "An extracted description that is also long enough to use safely.")).toBe(provided);
    });

    it("accepts public HTTP URLs and blocks local or credential-bearing URLs", () => {
        expect(normalizeManualUrl("https://example.com/jobs/123")).toBe("https://example.com/jobs/123");
        expect(() => normalizeManualUrl("http://127.0.0.1:4000/jobs")).toThrow("public website");
        expect(() => normalizeManualUrl("http://localhost/jobs")).toThrow("public website");
        expect(() => normalizeManualUrl("https://user:secret@example.com/jobs/123")).toThrow("embedded credentials");
        expect(() => normalizeManualUrl("file:///etc/passwd")).toThrow("http:// or https://");
    });
});
