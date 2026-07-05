import crypto from "crypto";

/**
 * Signed, expiring OAuth `state` parameter.
 *
 * Format:  base64url(JSON{ userId, iat, nonce }) + "." + base64url(HMAC-SHA256)
 *
 * The signature prevents one user from forging an OAuth callback that binds a
 * Google account to another user's id. The `iat` timestamp bounds the window in
 * which a captured state value can be replayed.
 */

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function stateSecret(): string {
    const secret = process.env.AUTH_TOKEN_SECRET ?? process.env.JWT_SECRET;
    if (!secret) {
        if (process.env.NODE_ENV === "production") {
            // Mirrors auth.service behaviour: refuse to run insecurely in prod.
            console.error("[FATAL] AUTH_TOKEN_SECRET is not set. Cannot sign OAuth state.");
            process.exit(1);
        }
        return "job-hunter-local-dev-secret-DO-NOT-USE-IN-PRODUCTION";
    }
    return secret;
}

function sign(payloadB64: string): string {
    return crypto.createHmac("sha256", stateSecret()).update(payloadB64).digest("base64url");
}

export function signOAuthState(userId: string): string {
    const payload = { userId, iat: Date.now(), nonce: crypto.randomBytes(8).toString("base64url") };
    const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    return `${payloadB64}.${sign(payloadB64)}`;
}

export function verifyOAuthState(state?: string | null): string {
    if (!state) throw new Error("Missing OAuth state.");

    const parts = state.split(".");
    if (parts.length !== 2) throw new Error("Invalid OAuth state.");
    const [payloadB64, signature] = parts;

    const expected = sign(payloadB64);
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        throw new Error("Invalid OAuth state signature.");
    }

    let payload: { userId?: string; iat?: number };
    try {
        payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    } catch {
        throw new Error("Invalid OAuth state payload.");
    }

    if (!payload.userId) throw new Error("Missing userId in OAuth state.");
    if (!payload.iat || Date.now() - payload.iat > STATE_TTL_MS) {
        throw new Error("OAuth state has expired. Please retry the connection.");
    }

    return payload.userId;
}
