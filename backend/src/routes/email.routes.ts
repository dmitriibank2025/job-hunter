import { Router } from "express";
import { requireUserIdFromRequest } from "../middleware/auth.middleware";
import { listAppliedVacancies, syncAppliedVacancyHistory } from "../services/applied-vacancy.service";
import { runEmailReport } from "../services/email-report.service";
import { userActionSchema } from "../validation";

export function createEmailRouter() {
    const router = Router();

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
        const limit = Number(req.query.limit ?? 100);
        const userId = await requireUserIdFromRequest(
            req,
            typeof req.query.userId === "string" ? req.query.userId : undefined,
        );
        const applications = await listAppliedVacancies(userId, Number.isFinite(limit) && limit > 0 ? limit : 100);

        res.json({
            count: applications.length,
            applications,
        });
    });

    return router;
}
