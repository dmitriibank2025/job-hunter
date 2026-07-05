describe("validateEnv in production", () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it("passes when all required vars are set in production", () => {
        process.env.NODE_ENV = "production";
        process.env.AUTH_TOKEN_SECRET = "a".repeat(32);
        process.env.CORS_ORIGIN = "https://example.com";
        process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";

        // Dynamically import to re-evaluate
        jest.resetModules();
        const { validateEnv } = require("../config/env");
        expect(() => validateEnv()).not.toThrow();
    });

    it("does not fail in development even without vars", () => {
        process.env.NODE_ENV = "development";
        delete process.env.AUTH_TOKEN_SECRET;
        delete process.env.CORS_ORIGIN;

        jest.resetModules();
        const { validateEnv } = require("../config/env");
        expect(() => validateEnv()).not.toThrow();
    });
});
