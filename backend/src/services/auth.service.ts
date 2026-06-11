import crypto from "crypto";
import { SubscriptionPlan, UserRole } from "@prisma/client";
import { HttpError } from "../errorHandler/http-error";
import { prisma } from "../infrastructure/prisma";
import { hashPassword, verifyPassword } from "./password.service";
import { PLAN_LIMITS } from "./user-workspace.service";

const ACCESS_TOKEN_TTL_SECONDS = Number(process.env.ACCESS_TOKEN_TTL_SECONDS ?? 24 * 60 * 60);
const REFRESH_TOKEN_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30);

type AccessTokenPayload = {
    sub: string;
    email: string;
    role: UserRole;
    exp: number;
};

function authSecret() {
    return process.env.AUTH_TOKEN_SECRET ?? process.env.JWT_SECRET ?? "job-hunter-local-dev-secret";
}

function base64Url(value: Buffer | string) {
    return Buffer.from(value).toString("base64url");
}

function signPayload(payload: AccessTokenPayload) {
    const encoded = base64Url(JSON.stringify(payload));
    const signature = crypto.createHmac("sha256", authSecret()).update(encoded).digest("base64url");

    return `${encoded}.${signature}`;
}

function verifyAccessToken(token: string): AccessTokenPayload {
    const [encoded, signature] = token.split(".");
    if (!encoded || !signature) throw new Error("Invalid access token.");

    const expected = crypto.createHmac("sha256", authSecret()).update(encoded).digest("base64url");
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        throw new Error("Invalid access token signature.");
    }

    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8")) as AccessTokenPayload;
    if (!payload.sub || !payload.email || !payload.exp) throw new Error("Invalid access token payload.");
    if (payload.exp <= Math.floor(Date.now() / 1000)) throw new Error("Access token expired.");

    return payload;
}

function hashToken(token: string) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

function refreshTokenExpiry() {
    const days = Number.isFinite(REFRESH_TOKEN_TTL_DAYS) && REFRESH_TOKEN_TTL_DAYS > 0 ? REFRESH_TOKEN_TTL_DAYS : 30;
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function issueTokens(user: { id: string; email: string; role: UserRole }) {
    const exp = Math.floor(Date.now() / 1000) + (Number.isFinite(ACCESS_TOKEN_TTL_SECONDS) ? ACCESS_TOKEN_TTL_SECONDS : 900);
    const accessToken = signPayload({
        sub: user.id,
        email: user.email,
        role: user.role,
        exp,
    });
    const refreshToken = crypto.randomBytes(48).toString("base64url");

    await prisma.authRefreshToken.create({
        data: {
            userId: user.id,
            tokenHash: hashToken(refreshToken),
            expiresAt: refreshTokenExpiry(),
        },
    });

    return {
        accessToken,
        refreshToken,
        tokenType: "Bearer",
        expiresAt: new Date(exp * 1000).toISOString(),
    };
}

function publicUser<T extends { passwordHash?: string | null; plan: SubscriptionPlan }>(user: T) {
    const { passwordHash: _passwordHash, ...safeUser } = user;

    return {
        ...safeUser,
        limits: PLAN_LIMITS[user.plan],
    };
}

export async function registerWithPassword(input: {
    email: string;
    password: string;
    fullName?: string;
    plan?: SubscriptionPlan;
    role?: UserRole;
}) {
    const email = input.email.trim().toLowerCase();
    const existing = await prisma.appUser.findUnique({ where: { email } });
    if (existing?.passwordHash) {
        throw new Error("User with this email already exists.");
    }

    const user = existing
        ? await prisma.appUser.update({
            where: { id: existing.id },
            data: {
                passwordHash: hashPassword(input.password),
                plan: input.plan ?? existing.plan,
                role: input.role ?? existing.role,
                profile: input.fullName
                    ? {
                        upsert: {
                            create: { fullName: input.fullName, email },
                            update: { fullName: input.fullName },
                        },
                    }
                    : undefined,
            },
            include: { profile: true },
        })
        : await prisma.appUser.create({
            data: {
                email,
                passwordHash: hashPassword(input.password),
                plan: input.plan ?? "FREE",
                role: input.role ?? "USER",
                profile: input.fullName ? { create: { fullName: input.fullName, email } } : undefined,
            },
            include: { profile: true },
        });

    return {
        user: publicUser(user),
        tokens: await issueTokens(user),
    };
}

export async function loginWithPassword(input: { email: string; password: string }) {
    const email = input.email.trim().toLowerCase();
    const user = await prisma.appUser.findUnique({
        where: { email },
        include: { profile: true },
    });

    if (!user?.passwordHash || !verifyPassword(input.password, user.passwordHash)) {
        throw new HttpError(401, "Invalid email or password.");
    }

    return {
        user: publicUser(user),
        tokens: await issueTokens(user),
    };
}

export async function refreshAuthTokens(refreshToken: string) {
    const tokenHash = hashToken(refreshToken);
    const storedToken = await prisma.authRefreshToken.findUnique({
        where: { tokenHash },
        include: { user: { include: { profile: true } } },
    });

    if (!storedToken || storedToken.revokedAt || storedToken.expiresAt <= new Date()) {
        throw new HttpError(401, "Invalid refresh token.");
    }

    await prisma.authRefreshToken.update({
        where: { id: storedToken.id },
        data: { revokedAt: new Date() },
    });

    return {
        user: publicUser(storedToken.user),
        tokens: await issueTokens(storedToken.user),
    };
}

export async function revokeRefreshToken(refreshToken: string) {
    await prisma.authRefreshToken.updateMany({
        where: {
            tokenHash: hashToken(refreshToken),
            revokedAt: null,
        },
        data: { revokedAt: new Date() },
    });
}

export async function getUserFromAccessToken(token: string) {
    const payload = verifyAccessToken(token);
    const user = await prisma.appUser.findUniqueOrThrow({
        where: { id: payload.sub },
        include: { profile: true },
    });

    return publicUser(user);
}

export function readBearerToken(header?: string) {
    const match = header?.match(/^Bearer\s+(.+)$/i);
    return match?.[1];
}
