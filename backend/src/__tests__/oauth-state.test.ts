import { signOAuthState, verifyOAuthState } from "../services/oauth-state.service";

describe("OAuth state signing", () => {
    const originalEnv = process.env;
    beforeEach(() => { process.env = { ...originalEnv, AUTH_TOKEN_SECRET: "x".repeat(32) }; });
    afterEach(() => { process.env = originalEnv; });

    it("round-trips a valid state back to the userId", () => {
        const state = signOAuthState("user-123");
        expect(verifyOAuthState(state)).toBe("user-123");
    });

    it("rejects a missing state", () => {
        expect(() => verifyOAuthState(undefined)).toThrow(/Missing OAuth state/);
    });

    it("rejects a malformed state", () => {
        expect(() => verifyOAuthState("not-a-valid-state")).toThrow(/Invalid OAuth state/);
    });

    it("rejects a forged userId (legacy plain base64url JSON)", () => {
        // An attacker tries the old, unsigned format binding their callback to another user.
        const forged = Buffer.from(JSON.stringify({ userId: "victim" }), "utf8").toString("base64url");
        expect(() => verifyOAuthState(forged)).toThrow(/Invalid OAuth state/);
    });

    it("rejects a tampered payload with a valid-looking signature section", () => {
        const state = signOAuthState("user-123");
        const [, sig] = state.split(".");
        const tamperedPayload = Buffer.from(
            JSON.stringify({ userId: "attacker", iat: Date.now(), nonce: "x" }),
            "utf8",
        ).toString("base64url");
        expect(() => verifyOAuthState(`${tamperedPayload}.${sig}`)).toThrow(/signature/);
    });

    it("rejects an expired state", () => {
        const state = signOAuthState("user-123");
        const realNow = Date.now;
        // jump 11 minutes into the future
        Date.now = () => realNow() + 11 * 60 * 1000;
        try {
            expect(() => verifyOAuthState(state)).toThrow(/expired/);
        } finally {
            Date.now = realNow;
        }
    });

    it("rejects a state signed with a different secret", () => {
        const state = signOAuthState("user-123");
        process.env.AUTH_TOKEN_SECRET = "y".repeat(32);
        expect(() => verifyOAuthState(state)).toThrow(/signature/);
    });
});
