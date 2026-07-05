/**
 * Verifies that legacy PBKDF2 password hashes are transparently upgraded to
 * argon2id after a successful login, on every auth path that accepts them.
 */
import crypto from "crypto";

const updateMock = jest.fn().mockResolvedValue({});
const findUniqueMock = jest.fn();
const createMock = jest.fn().mockResolvedValue({});

jest.mock("../infrastructure/prisma", () => ({
    prisma: {
        appUser: {
            findUnique: (...a: unknown[]) => findUniqueMock(...a),
            update: (...a: unknown[]) => updateMock(...a),
            create: (...a: unknown[]) => createMock(...a),
        },
        authRefreshToken: { create: jest.fn().mockResolvedValue({}) },
    },
}));

function legacyHash(password: string): string {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
    return `${salt}:${hash}`;
}

describe("legacy password migration", () => {
    const originalEnv = process.env;
    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...originalEnv, AUTH_TOKEN_SECRET: "z".repeat(40) };
    });
    afterEach(() => { process.env = originalEnv; });

    it("loginWithPassword upgrades a legacy hash to argon2id", async () => {
        findUniqueMock.mockResolvedValue({
            id: "u1", email: "a@b.com", role: "USER", plan: "FREE",
            passwordHash: legacyHash("secret"), profile: null,
        });

        const { loginWithPassword } = require("../services/auth.service");
        await loginWithPassword({ email: "a@b.com", password: "secret" });

        expect(updateMock).toHaveBeenCalledTimes(1);
        const arg = updateMock.mock.calls[0][0];
        expect(arg.where).toEqual({ id: "u1" });
        expect(arg.data.passwordHash).toMatch(/^\$argon2id\$/);
    });

    it("loginWithPassword does NOT rehash an up-to-date argon2id hash", async () => {
        // Use the service's own hasher so the cost params match exactly → no rehash.
        const { hashPassword } = require("../services/password.service");
        const modernHash = await hashPassword("secret");
        findUniqueMock.mockResolvedValue({
            id: "u2", email: "a@b.com", role: "USER", plan: "FREE",
            passwordHash: modernHash, profile: null,
        });

        const { loginWithPassword } = require("../services/auth.service");
        await loginWithPassword({ email: "a@b.com", password: "secret" });

        expect(updateMock).not.toHaveBeenCalled();
    });

    it("loginWorkspaceUser upgrades a legacy hash to argon2id", async () => {
        findUniqueMock.mockResolvedValue({
            id: "u3", email: "a@b.com", role: "USER", plan: "FREE",
            passwordHash: legacyHash("secret"), profile: null,
        });

        const { loginWorkspaceUser } = require("../services/user-workspace.service");
        await loginWorkspaceUser({ email: "a@b.com", password: "secret" });

        expect(updateMock).toHaveBeenCalledTimes(1);
        expect(updateMock.mock.calls[0][0].data.passwordHash).toMatch(/^\$argon2id\$/);
    });
});
