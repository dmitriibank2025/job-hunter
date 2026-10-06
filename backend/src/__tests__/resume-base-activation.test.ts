jest.mock("../infrastructure/prisma", () => ({ prisma: {} }));

import { buildResumeBaseActivationUpdate } from "../services/user-workspace.service";

describe("resume base activation", () => {
    const current = {
        dailyAutomationFullstackResumeBaseId: "full-old",
        dailyAutomationBackendResumeBaseId: "edited",
        dailyAutomationFrontendResumeBaseId: "front-old",
    };

    it("activates a saved base for its target", () => {
        expect(buildResumeBaseActivationUpdate("edited", "FULLSTACK", current)).toEqual({
            dailyAutomationFullstackResumeBaseId: "edited",
            dailyAutomationBackendResumeBaseId: null,
            dailyAutomationFrontendResumeBaseId: undefined,
        });
    });

    it("does not assign a custom base to a role", () => {
        expect(buildResumeBaseActivationUpdate("custom", "CUSTOM", current)).toEqual({
            dailyAutomationFullstackResumeBaseId: undefined,
            dailyAutomationBackendResumeBaseId: undefined,
            dailyAutomationFrontendResumeBaseId: undefined,
        });
    });
});
