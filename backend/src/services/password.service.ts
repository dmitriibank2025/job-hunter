import crypto from "crypto";

/**
 * Generates a PBKDF2 hash for a password with a random salt.
 * Format of return value is: salt:hash
 */
export function hashPassword(password: string): string {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
    return `${salt}:${hash}`;
}

/**
 * Verifies a password against a stored hash string (format: salt:hash).
 */
export function verifyPassword(password: string, storedHash: string): boolean {
    if (!storedHash) return false;
    const parts = storedHash.split(":");
    if (parts.length !== 2) return false;
    const [salt, hash] = parts;
    const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
    return hash === verifyHash;
}
