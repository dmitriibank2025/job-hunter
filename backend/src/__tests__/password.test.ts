import crypto from "crypto";
import { hashPassword, verifyPassword } from "../services/password.service";

describe("hashPassword", () => {
    it("produces an argon2id hash", async () => {
        const hash = await hashPassword("correct-horse-battery");
        expect(hash).toMatch(/^\$argon2id\$/);
    });

    it("produces different hashes for the same password", async () => {
        const h1 = await hashPassword("same");
        const h2 = await hashPassword("same");
        expect(h1).not.toBe(h2);
    });
});

describe("verifyPassword – argon2id hashes", () => {
    it("returns ok=true, needsRehash=false for correct password", async () => {
        const hash = await hashPassword("hunter2");
        const result = await verifyPassword("hunter2", hash);
        expect(result).toEqual({ ok: true, needsRehash: false });
    });

    it("returns ok=false for wrong password", async () => {
        const hash = await hashPassword("hunter2");
        const result = await verifyPassword("wrong", hash);
        expect(result).toEqual({ ok: false, needsRehash: false });
    });
});

describe("verifyPassword – legacy PBKDF2 hashes", () => {
    function legacyHash(password: string): string {
        const salt = crypto.randomBytes(16).toString("hex");
        const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
        return `${salt}:${hash}`;
    }

    it("returns ok=true, needsRehash=true for correct legacy password", async () => {
        const stored = legacyHash("oldpassword");
        const result = await verifyPassword("oldpassword", stored);
        expect(result).toEqual({ ok: true, needsRehash: true });
    });

    it("returns ok=false for wrong legacy password", async () => {
        const stored = legacyHash("oldpassword");
        const result = await verifyPassword("wrong", stored);
        expect(result).toEqual({ ok: false, needsRehash: false });
    });
});

describe("verifyPassword – edge cases", () => {
    it("returns ok=false for empty storedHash", async () => {
        const result = await verifyPassword("pw", "");
        expect(result).toEqual({ ok: false, needsRehash: false });
    });

    it("returns ok=false for unrecognised hash format", async () => {
        const result = await verifyPassword("pw", "notahash");
        expect(result).toEqual({ ok: false, needsRehash: false });
    });
});
