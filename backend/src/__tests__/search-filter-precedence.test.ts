import { resolveExcludeRemote } from "../services/company-blacklist.service";

describe("search filter precedence", () => {
    it("honors an explicitly selected remote target over a persisted exclusion", () => {
        expect(resolveExcludeRemote({ targetLocations: ["Israel", "Remote Europe"] }, true)).toBe(false);
    });

    it("keeps an explicit per-run remote exclusion", () => {
        expect(resolveExcludeRemote({ targetLocations: ["Remote Europe"], excludeRemote: true }, false)).toBe(true);
    });

    it("uses the persisted exclusion when remote was not selected", () => {
        expect(resolveExcludeRemote({ targetLocations: ["Israel", "Tel Aviv"] }, true)).toBe(true);
    });
});
