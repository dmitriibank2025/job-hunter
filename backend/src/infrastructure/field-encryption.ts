/**
 * AES-256-GCM field-level encryption for sensitive DB columns.
 *
 * Encrypted format (base64url-encoded):
 *   <12-byte IV> | <ciphertext> | <16-byte auth tag>
 *   All concatenated then base64url-encoded, prefixed with "enc:" sentinel.
 *
 * Plain-text values are passed through transparently so existing rows remain
 * readable until re-encrypted.  On next write they will be encrypted.
 *
 * Required env var:  ENCRYPTION_KEY  (32 raw bytes as 64 hex chars)
 *
 * Generate:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
import crypto from "crypto";
import { logger } from "../Logger/logger";

const SENTINEL = "enc:";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function getKey(): Buffer | null {
    const raw = process.env.ENCRYPTION_KEY;
    if (!raw) return null;
    if (raw.length !== 64 || !/^[0-9a-fA-F]+$/.test(raw)) {
        logger.error("ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes).");
        if (process.env.NODE_ENV === "production") process.exit(1);
        return null;
    }
    return Buffer.from(raw, "hex");
}

export function encrypt(plaintext: string): string {
    const key = getKey();
    if (!key) return plaintext; // no key configured → store as-is (dev/migration)

    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGO, key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const combined = Buffer.concat([iv, ct, tag]);
    return SENTINEL + combined.toString("base64url");
}

export function decrypt(stored: string): string {
    if (!stored || !stored.startsWith(SENTINEL)) return stored; // plaintext passthrough

    const key = getKey();
    if (!key) {
        logger.warn("ENCRYPTION_KEY not set but encrypted field found – returning raw value.");
        return stored; // can't decrypt without key
    }

    const buf = Buffer.from(stored.slice(SENTINEL.length), "base64url");
    if (buf.length < IV_BYTES + TAG_BYTES + 1) {
        logger.warn("Encrypted field is too short – returning raw value.");
        return stored;
    }

    const iv = buf.subarray(0, IV_BYTES);
    const tag = buf.subarray(buf.length - TAG_BYTES);
    const ct = buf.subarray(IV_BYTES, buf.length - TAG_BYTES);

    try {
        const decipher = crypto.createDecipheriv(ALGO, key, iv);
        decipher.setAuthTag(tag);
        return decipher.update(ct) + decipher.final("utf8");
    } catch {
        logger.error("Field decryption failed – ciphertext tampered or wrong key.");
        return stored;
    }
}

export function isEncrypted(value: string | null | undefined): boolean {
    return typeof value === "string" && value.startsWith(SENTINEL);
}

/**
 * Validate that ENCRYPTION_KEY is present and valid in production when
 * user-level secrets (Gmail tokens, Telegram tokens) may be stored.
 * Call once at startup.
 */
export function requireEncryptionKeyInProduction() {
    if (process.env.NODE_ENV !== "production") return;
    const key = process.env.ENCRYPTION_KEY;
    if (!key || key.length !== 64 || !/^[0-9a-fA-F]+$/.test(key)) {
        logger.error(
            "[FATAL] ENCRYPTION_KEY must be set to a 64-hex-char value in production " +
            "to protect per-user Gmail and Telegram secrets.",
        );
        process.exit(1);
    }
}
