import { encrypt, decrypt, isEncrypted } from "../infrastructure/field-encryption";

const VALID_KEY = "a".repeat(64); // 64 hex chars = 32 bytes

describe("field-encryption with ENCRYPTION_KEY set", () => {
    beforeAll(() => { process.env.ENCRYPTION_KEY = VALID_KEY; });
    afterAll(() => { delete process.env.ENCRYPTION_KEY; });

    it("encrypt produces enc: prefix", () => {
        expect(encrypt("secret")).toMatch(/^enc:/);
    });

    it("round-trips plaintext correctly", () => {
        const ct = encrypt("my-refresh-token-abc");
        expect(decrypt(ct)).toBe("my-refresh-token-abc");
    });

    it("produces different ciphertexts for same plaintext (random IV)", () => {
        expect(encrypt("same")).not.toBe(encrypt("same"));
    });

    it("isEncrypted returns true for enc: values", () => {
        expect(isEncrypted(encrypt("x"))).toBe(true);
    });

    it("isEncrypted returns false for plaintext", () => {
        expect(isEncrypted("plainvalue")).toBe(false);
    });
});

describe("field-encryption without ENCRYPTION_KEY (passthrough mode)", () => {
    beforeAll(() => { delete process.env.ENCRYPTION_KEY; });

    it("encrypt returns plaintext unchanged", () => {
        expect(encrypt("value")).toBe("value");
    });

    it("decrypt returns plaintext passthrough unchanged", () => {
        expect(decrypt("not-encrypted")).toBe("not-encrypted");
    });
});

describe("decrypt backward compatibility", () => {
    beforeAll(() => { process.env.ENCRYPTION_KEY = VALID_KEY; });
    afterAll(() => { delete process.env.ENCRYPTION_KEY; });

    it("returns plaintext as-is (legacy rows)", () => {
        expect(decrypt("old-token-stored-plaintext")).toBe("old-token-stored-plaintext");
    });
});
