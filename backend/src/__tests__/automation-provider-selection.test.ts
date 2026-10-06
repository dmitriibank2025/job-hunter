import { automationRunSchema } from "../validation/api.schemas";

describe("automation provider selection", () => {
    it("accepts an allowlisted provider selection", () => {
        const result = automationRunSchema.parse({
            sourceMode: "PROVIDERS",
            providerNames: ["LINKEDIN", "GREENHOUSE", "DEVJOBS"],
        });

        expect(result.providerNames).toEqual(["LINKEDIN", "GREENHOUSE", "DEVJOBS"]);
    });

    it("rejects an empty provider selection", () => {
        expect(() => automationRunSchema.parse({ providerNames: [] })).toThrow();
    });

    it("rejects unknown provider names", () => {
        expect(() => automationRunSchema.parse({ providerNames: ["UNTRUSTED_SOURCE"] })).toThrow();
    });
});
