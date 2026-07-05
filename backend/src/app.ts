import cors from "cors";
import express from "express";
import helmet from "helmet";
import path from "path";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import { loadEnv } from "./config/env";
import { errorHandler } from "./errorHandler/error-handler";
import { logger } from "./Logger/logger";
import {
    LANGUAGE_OPTIONS,
    PLAN_LIMITS,
    TECHNOLOGY_CATALOG,
} from "./services/user-workspace.service";
import {
    createAdminRouter,
    createAuthRouter,
    createCandidateRouter,
    createEmailRouter,
    createJobsRouter,
    createLinkedInRouter,
    createStorageRouter,
    createTelegramRouter,
    createTelegramWebhookRouter,
    createUsersRouter,
} from "./routes";
import { handleGmailOAuthCallback } from "./routes/email.routes";

loadEnv();

function buildCorsOrigin(): string[] | true {
    const raw = process.env.CORS_ORIGIN;
    if (!raw) {
        if (process.env.NODE_ENV === "production") {
            logger.error("[FATAL] CORS_ORIGIN is not set in production. Refusing to start with open CORS.");
            process.exit(1);
        }
        return true;
    }
    return raw.split(",").map((o) => o.trim()).filter(Boolean);
}

export function createApp() {
    const app = express();

    // Request ID — корреляция логов
    app.use((_req, res, next) => {
        const requestId = crypto.randomUUID();
        res.setHeader("X-Request-Id", requestId);
        next();
    });

    // Security headers
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", "data:", "https:"],
                connectSrc: ["'self'"],
                fontSrc: ["'self'"],
                objectSrc: ["'none'"],
                frameAncestors: ["'none'"],
            },
        },
        hsts: {
            maxAge: 31536000,
            includeSubDomains: true,
        },
    }));

    // CORS
    app.use(cors({
        origin: buildCorsOrigin(),
        credentials: true,
    }));

    app.use(express.json({ limit: "2mb" }));

    const rl = (windowMs: number, max: number, msg?: string) =>
        rateLimit({
            windowMs,
            max,
            standardHeaders: true,
            legacyHeaders: false,
            ...(msg ? { message: { success: false, message: msg } } : {}),
        });

    // Auth: login/register brute-force guard – 10 attempts per 15 min
    const authWriteLimiter = rl(15 * 60 * 1000, 10, "Too many auth attempts – try again in 15 minutes.");
    // Auth reads (me, refresh) – more relaxed
    const authReadLimiter  = rl(60 * 1000, 30);

    // AI-heavy: analysis, resume generation, cover letter – 6 per min
    const generationLimiter = rl(60 * 1000, 6, "Too many generation requests – please wait.");
    // Full automation run – 3 per min
    const automationLimiter = rl(60 * 1000, 3, "Too many automation runs – please wait.");
    // Provider scraping (email report, LinkedIn) – 5 per min
    const scrapingLimiter   = rl(60 * 1000, 5, "Too many scraping requests – please wait.");
    // Storage downloads – 60 per min
    const storageLimiter    = rl(60 * 1000, 60);
    // General dashboard reads – 120 per min
    const apiLimiter        = rl(60 * 1000, 120);
    // Telegram webhook – Telegram may burst updates; keep generous.
    const webhookLimiter    = rl(60 * 1000, 240);
    // Unused alias kept for backward compat
    const authLimiter = authWriteLimiter;

    app.use("/storage", storageLimiter, createStorageRouter());

    if (process.env.SERVE_FRONTEND === "true") {
        app.use(express.static(path.join(process.cwd(), "public")));
    }

    // Liveness: always 200 if process is up
    app.get("/health", (_req, res) => { res.json({ status: "OK" }); });
    app.get("/health/live", (_req, res) => { res.json({ status: "OK" }); });

    // Readiness: checks DB connectivity and storage config
    app.get("/health/ready", async (_req, res) => {
        const checks: Record<string, { ok: boolean; detail?: string }> = {};

        // DB
        try {
            await import("./infrastructure/prisma.js").then(({ prisma }) =>
                prisma.$queryRaw`SELECT 1`,
            );
            checks.db = { ok: true };
        } catch (err) {
            checks.db = { ok: false, detail: err instanceof Error ? err.message : "db error" };
        }

        // Storage
        try {
            const { isS3Enabled } = await import("./infrastructure/object-storage.js");
            if (isS3Enabled()) {
                const bucket = process.env.S3_BUCKET;
                checks.storage = bucket
                    ? { ok: true, detail: `s3:${bucket}` }
                    : { ok: false, detail: "USE_S3=true but S3_BUCKET not set" };
            } else {
                const { getStorageRoot } = await import("./services/file-storage.service.js");
                const fs = await import("fs");
                const root = getStorageRoot();
                checks.storage = fs.existsSync(root)
                    ? { ok: true, detail: `local:${root}` }
                    : { ok: false, detail: `local storage dir missing: ${root}` };
            }
        } catch (err) {
            checks.storage = { ok: false, detail: err instanceof Error ? err.message : "storage error" };
        }

        const allOk = Object.values(checks).every((c) => c.ok);
        res.status(allOk ? 200 : 503).json({ status: allOk ? "OK" : "DEGRADED", checks });
    });

    // Auth routes: write (login/register/logout) vs read (me/refresh)
    app.use("/auth", createAuthRouter({ writeLimiter: authWriteLimiter, readLimiter: authReadLimiter }));
    app.use("/users", apiLimiter, createUsersRouter());
    app.use("/admin", apiLimiter, createAdminRouter());
    app.use("/candidate", apiLimiter, createCandidateRouter());
    app.get("/oauth/google/callback", handleGmailOAuthCallback);
    app.use("/email", apiLimiter, createEmailRouter());
    app.use("/jobs", createJobsRouter({ automationLimiter, generationLimiter, scrapingLimiter, apiLimiter }));
    app.use("/linkedin", apiLimiter, createLinkedInRouter());
    app.use("/api/linkedin", apiLimiter, createLinkedInRouter());

    // Telegram guided connect flow (authenticated) + public webhook.
    app.use("/api/user/telegram", apiLimiter, createTelegramRouter());
    // Webhook is hit by Telegram's servers; authenticated by the path secret,
    // given a generous limiter so legitimate update bursts are not dropped.
    app.use("/api/integrations/telegram", webhookLimiter, createTelegramWebhookRouter());

    app.get("/plans", (_req, res) => {
        res.json({
            success: true,
            plans: PLAN_LIMITS,
        });
    });

    app.get("/technologies/catalog", (_req, res) => {
        res.json({
            success: true,
            technologies: TECHNOLOGY_CATALOG,
            languages: LANGUAGE_OPTIONS,
        });
    });

    app.get("/", (_req, res) => {
        if (process.env.SERVE_FRONTEND !== "true") {
            res.json({
                service: "job-hunter-api",
                status: "OK",
            });
            return;
        }

        res.sendFile(path.join(process.cwd(), "public", "index.html"));
    });

    app.use(errorHandler);

    return app;
}

export const app = createApp();
