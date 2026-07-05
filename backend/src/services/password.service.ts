import crypto from "crypto";
import argon2 from "argon2";

// Argon2id parameters – OWASP recommended minimums (2024)
const ARGON2_OPTIONS: argon2.Options & { raw?: false } = {
    type: argon2.argon2id,
    memoryCost: 64 * 1024, // 64 MiB
    timeCost: 3,
    parallelism: 1,
};

const ARGON2_PREFIX = "$argon2id$";
const LEGACY_PBKDF2_ITERATIONS = 1000;

function isArgon2Hash(stored: string): boolean {
    return stored.startsWith(ARGON2_PREFIX);
}

function isLegacyPbkdf2Hash(stored: string): boolean {
    // legacy format: "<hex-salt>:<hex-hash>" – no $ signs
    return !stored.startsWith("$") && stored.includes(":");
}

/** Hash a password with argon2id. Always use this for new hashes. */
export async function hashPassword(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
}

/**
 * Verify a password against any supported stored hash format.
 *
 * Returns:
 *  - `{ ok: false }` — wrong password
 *  - `{ ok: true, needsRehash: false }` — correct, argon2id hash already up-to-date
 *  - `{ ok: true, needsRehash: true }` — correct, but stored hash is legacy PBKDF2;
 *    callers should call `hashPassword` and persist the new hash.
 */
export async function verifyPassword(
    password: string,
    storedHash: string,
): Promise<{ ok: boolean; needsRehash: boolean }> {
    if (!storedHash) return { ok: false, needsRehash: false };

    if (isArgon2Hash(storedHash)) {
        const ok = await argon2.verify(storedHash, password);
        // argon2.needsRehash detects outdated cost parameters
        const needsRehash = ok && argon2.needsRehash(storedHash, ARGON2_OPTIONS);
        return { ok, needsRehash };
    }

    if (isLegacyPbkdf2Hash(storedHash)) {
        const parts = storedHash.split(":");
        if (parts.length !== 2) return { ok: false, needsRehash: false };
        const [salt, hash] = parts;
        const candidate = crypto
            .pbkdf2Sync(password, salt, LEGACY_PBKDF2_ITERATIONS, 64, "sha512")
            .toString("hex");
        const ok = crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(candidate, "hex"));
        return { ok, needsRehash: ok }; // always rehash on success
    }

    return { ok: false, needsRehash: false };
}
