import { Router } from "express";
import type { Request, Response } from "express";
import { requireUserIdFromRequest } from "../middleware/auth.middleware";
import {
    createTelegramConnectSession,
    disconnectTelegram,
    getTelegramStatus,
    getConfiguredWebhookSecret,
    handleTelegramWebhookUpdate,
} from "../services/telegram-connect.service";
import crypto from "crypto";

/** Authenticated user-facing connect/status/disconnect endpoints. */
export function createTelegramRouter() {
    const router = Router();

    // POST /api/user/telegram/connect
    router.post("/connect", async (req: Request, res: Response) => {
        const userId = await requireUserIdFromRequest(
            req,
            typeof req.body?.userId === "string" ? req.body.userId : undefined,
        );
        const session = await createTelegramConnectSession(userId);
        res.json({ success: true, ...session });
    });

    // GET /api/user/telegram/status
    router.get("/status", async (req: Request, res: Response) => {
        const userId = await requireUserIdFromRequest(
            req,
            typeof req.query.userId === "string" ? req.query.userId : undefined,
        );
        res.json({ success: true, ...(await getTelegramStatus(userId)) });
    });

    // POST /api/user/telegram/disconnect
    router.post("/disconnect", async (req: Request, res: Response) => {
        const userId = await requireUserIdFromRequest(
            req,
            typeof req.body?.userId === "string" ? req.body.userId : undefined,
        );
        await disconnectTelegram(userId);
        res.json({ success: true });
    });

    return router;
}

/** Public webhook endpoint hit by Telegram. Authenticated only by the path secret. */
export function createTelegramWebhookRouter() {
    const router = Router();

    // POST /api/integrations/telegram/webhook/:secret
    router.post("/webhook/:secret", async (req: Request, res: Response) => {
        const provided = String(req.params.secret ?? "");
        const expected = getConfiguredWebhookSecret();
        const a = Buffer.from(provided);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
            // Do not leak which part failed.
            res.status(403).json({ ok: false });
            return;
        }

        // Always 200 quickly so Telegram doesn't retry; process best-effort.
        try {
            await handleTelegramWebhookUpdate(req.body);
        } catch {
            // swallow — handler logs internally
        }
        res.json({ ok: true });
    });

    return router;
}
