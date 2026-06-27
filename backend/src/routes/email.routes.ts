import { Router } from "express";
import type { Request, Response } from "express";
import { requireUserIdFromRequest } from "../middleware/auth.middleware";
import { listAppliedVacancies, syncAppliedVacancyHistory } from "../services/applied-vacancy.service";
import { runEmailReport } from "../services/email-report.service";
import {
    buildGmailAuthUrl,
    connectGmailFromOAuthCallback,
    getGmailConnectionStatus,
} from "../services/gmail-api.service";
import { userActionSchema } from "../validation";

export async function handleGmailOAuthCallback(req: Request, res: Response) {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : undefined;

    if (!code) {
        res.status(400).send("Missing Gmail OAuth code.");
        return;
    }

    const account = await connectGmailFromOAuthCallback({ code, state });

    res
        .status(200)
        .type("html")
        .send(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>Gmail connected</title></head>
<body style="font-family: system-ui, sans-serif; padding: 32px;">
  <h1>Gmail connected</h1>
  <p>Connected account: ${account.email ?? "Gmail"}</p>
  <p>You can close this tab and return to Job Hunter.</p>
</body>
</html>`);
}

export function createEmailRouter() {
    const router = Router();

    router.get("/gmail/status", async (req, res) => {
        const userId = await requireUserIdFromRequest(
            req,
            typeof req.query.userId === "string" ? req.query.userId : undefined,
        );
        res.json(await getGmailConnectionStatus(userId));
    });

    router.post("/gmail/auth-url", async (req, res) => {
        const body = userActionSchema.parse(req.body ?? {});
        const userId = await requireUserIdFromRequest(req, body.userId);

        res.json({
            success: true,
            authUrl: buildGmailAuthUrl(userId),
        });
    });

    router.get("/gmail/callback", handleGmailOAuthCallback);

    router.post("/report", async (req, res) => {
        const body = userActionSchema.parse(req.body ?? {});
        const userId = await requireUserIdFromRequest(req, body.userId);
        const report = await runEmailReport(userId);

        res.json({
            success: true,
            enabled: report.enabled,
            configured: report.configured,
            syncedCount: report.syncedCount,
            newEventsCount: report.newEventsCount,
            appliedHistoryFromEmails: report.appliedHistoryFromEmails,
            appliedHistoryFromLocalApplications: report.appliedHistoryFromLocalApplications,
            eventsCount: report.events.length,
            events: report.events,
            message: report.message,
        });
    });

    router.post("/applications/sync", async (req, res) => {
        const body = userActionSchema.parse(req.body ?? {});
        const userId = await requireUserIdFromRequest(req, body.userId);
        const result = await syncAppliedVacancyHistory(userId);

        res.json({
            success: true,
            ...result,
        });
    });

    router.get("/applications", async (req, res) => {
        const requestedLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
        const userId = await requireUserIdFromRequest(
            req,
            typeof req.query.userId === "string" ? req.query.userId : undefined,
        );
        const applications = await listAppliedVacancies(userId, requestedLimit);

        res.json({
            count: applications.length,
            applications,
        });
    });

    return router;
}
