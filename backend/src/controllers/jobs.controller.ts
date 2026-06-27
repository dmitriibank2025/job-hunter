import type { Request, Response } from "express";
import { requiredParam } from "./request-params";
import { requireAuthUser, requireUserIdFromRequest } from "../middleware/auth.middleware";
import { analyzeJob } from "../services/job-analyzer.service";
import { runJobAutomationWorkflowWithSource } from "../services/job-automation.service";
import { getAutomationProgress } from "../services/job-automation-progress.service";
import { runDailyJobReport } from "../services/daily-job-report.service";
import {
    generateApplicationPackageForJob,
    generateCoverLetterForJob,
    generateResumeForJob,
} from "../services/resume-generator.service";
import { submitCompanyApplicationForJob } from "../services/company-application-submitter.service";
import { listCompanyPriorityTargets } from "../services/company-priority.service";
import { sendTelegramMessage } from "../services/telegram.service";
import { upsertUserJobMatch } from "../services/user-workspace.service";
import { ensureUserJobMatchesForUserArtifacts } from "../services/user-job-repair.service";
import { generatePromptRefinement, getRejectedResumeReport, recordRejection } from "../services/prompt-learning.service";
import {
    automationRunSchema,
    manualVacancyExtractSchema,
    manualVacancySchema,
    submitApplicationSchema,
    telegramNotificationSchema,
    userActionSchema,
    userJobMatchSchema,
} from "../validation";
import {
    extractManualVacancyFromUrl,
    normalizeManualUrl,
    processManualVacancy,
} from "../services/manual-vacancy.service";
import {
    analyzeMissingUserJobs,
    getUserJobStatistics,
    listTopUserJobs,
    listUserJobs,
} from "../services/job-query.service";

export async function extractManualVacancy(req: Request, res: Response) {
    const input = manualVacancyExtractSchema.parse(req.body ?? {});
    const url = normalizeManualUrl(input.url);

    if (!url) {
        throw new Error("Vacancy URL is required.");
    }

    const extracted = await extractManualVacancyFromUrl(url);

    res.json({
        success: true,
        url,
        vacancy: extracted,
    });
}

export async function createManualVacancy(req: Request, res: Response) {
    const input = manualVacancySchema.parse(req.body ?? {});
    const userId = await requireUserIdFromRequest(req, input.userId);
    const result = await processManualVacancy(userId, input);
    const { statusCode, ...body } = result;

    res.status(statusCode).json(body);
}

export async function createDailyReport(req: Request, res: Response) {
    const body = userActionSchema.parse(req.body ?? {});
    const userId = await requireUserIdFromRequest(req, body.userId);
    const report = await runDailyJobReport(userId);

    res.json({
        success: true,
        newJobsCount: report.newJobs.length,
        emailEventsCount: report.emailReport.events.length,
        emailSyncedCount: report.emailReport.syncedCount,
        newEmailEventsCount: report.emailReport.newEventsCount,
        telegramSent: report.telegramSent,
        message: report.message,
    });
}

export async function sendTelegramNotification(req: Request, res: Response) {
    const body = telegramNotificationSchema.parse(req.body ?? {});
    await requireUserIdFromRequest(req, body.userId);
    const telegramSent = await sendTelegramMessage(body.message);

    res.json({
        success: true,
        telegramSent,
    });
}

export async function runAutomation(req: Request, res: Response) {
    const body = automationRunSchema.parse(req.body ?? {});
    const userId = await requireUserIdFromRequest(req, body.userId);
    const report = await runJobAutomationWorkflowWithSource({
        userId,
        searchLocation: body.searchLocation,
        sourceMode: body.sourceMode ?? "PROVIDERS",
        preferences: body.preferences,
        resumeBaseId: body.resumeBaseId,
        resumeBaseIds: body.resumeBaseIds,
    });

    res.json({
        success: true,
        collectedAt: report.collectedAt,
        searchLocation: report.searchLocation,
        sourceMode: report.sourceMode,
        newJobsCount: report.newJobs.length,
        analyzedJobsCount: report.analyzedJobs.length,
        generatedResumesCount: report.generatedResumes.length,
        generatedCoverLettersCount: report.generatedCoverLetters.length,
        appliedHistoryNeedsReplyCount: report.followUp.needsReply.length,
        appliedHistoryAnsweredCount: report.followUp.answered.length,
        emailSyncedCount: report.emailReport.syncedCount,
        newEmailEventsCount: report.emailReport.newEventsCount,
        telegramSent: report.telegramSent,
        message: report.message,
        preferenceFilterStats: report.preferenceFilterStats,
        userLimitStats: report.userLimitStats,
        newJobs: report.newJobs,
        analyzedJobs: report.analyzedJobs,
        generatedResumes: report.generatedResumes,
        generatedCoverLetters: report.generatedCoverLetters,
        followUp: report.followUp,
    });
}

export async function getAutomationStatus(req: Request, res: Response) {
    await requireAuthUser(req);
    res.json({
        success: true,
        progress: getAutomationProgress(),
    });
}

export async function listCenterIsraelCompanies(req: Request, res: Response) {
    const activeOnly = req.query.active !== "false";
    const limit = Number(req.query.limit ?? 100);
    const companies = await listCompanyPriorityTargets({
        activeOnly,
        limit: Number.isFinite(limit) && limit > 0 ? limit : 100,
    });

    res.json({
        success: true,
        activeOnly,
        count: companies.length,
        companies,
    });
}

export async function analyzeAllMissingJobs(req: Request, res: Response) {
    const options = userActionSchema.parse(req.body ?? {});
    const userId = await requireUserIdFromRequest(req, options.userId);
    const result = await analyzeMissingUserJobs(userId, options.resumeBaseId, options.resumeBaseIds);

    res.json(result);
}

export async function repairUserMatches(req: Request, res: Response) {
    const options = userActionSchema.parse(req.body ?? {});
    const userId = await requireUserIdFromRequest(req, options.userId);
    const result = await ensureUserJobMatchesForUserArtifacts(userId);

    res.json({
        success: true,
        ...result,
    });
}

export async function getTopJobs(req: Request, res: Response) {
    const userId = await requireUserIdFromRequest(
        req,
        typeof req.query.userId === "string" ? req.query.userId : undefined,
    );

    res.json(await listTopUserJobs(userId));
}

export async function getStatistics(req: Request, res: Response) {
    const userId = await requireUserIdFromRequest(
        req,
        typeof req.query.userId === "string" ? req.query.userId : undefined,
    );

    res.json(await getUserJobStatistics(userId));
}

export async function getRejectionsResumeReport(req: Request, res: Response) {
    const userId = await requireUserIdFromRequest(
        req,
        typeof req.query.userId === "string" ? req.query.userId : undefined,
    );

    res.json(await getRejectedResumeReport(userId));
}

export async function refinePromptRules(req: Request, res: Response) {
    const options = userActionSchema.parse(req.body ?? {});
    const userId = await requireUserIdFromRequest(req, options.userId);
    const rules = await generatePromptRefinement(userId);

    res.json({
        success: true,
        rulesGenerated: rules.length,
        rules,
    });
}

export async function listJobs(req: Request, res: Response) {
    const requestedUserId = typeof req.query.userId === "string" ? req.query.userId : undefined;
    const userId = await requireUserIdFromRequest(req, requestedUserId);

    res.json(await listUserJobs(userId));
}

export async function analyzeOneJob(req: Request, res: Response) {
    const jobId = requiredParam(req, "id");
    const options = userActionSchema.parse(req.body ?? {});
    const userId = await requireUserIdFromRequest(req, options.userId);
    const result = await analyzeJob(jobId, { userId, resumeBaseId: options.resumeBaseId, resumeBaseIds: options.resumeBaseIds });

    res.json(result);
}

export async function updateUserMatch(req: Request, res: Response) {
    const jobId = requiredParam(req, "id");
    const input = userJobMatchSchema.parse(req.body ?? {});
    const userId = await requireUserIdFromRequest(req, input.userId);
    const userMatch = await upsertUserJobMatch(userId, jobId, input);

    if (input.status === "REJECTED") {
        await recordRejection({
            userId,
            jobId,
            reason: input.rejectionReason ?? "OTHER",
            employerFeedback: input.notes,
        });
    }

    res.json({
        success: true,
        userMatch,
    });
}

export async function generateResume(req: Request, res: Response) {
    const jobId = requiredParam(req, "id");
    const options = userActionSchema.parse(req.body ?? {});
    const userId = await requireUserIdFromRequest(req, options.userId);
    const resume = await generateResumeForJob(jobId, { userId, resumeBaseId: options.resumeBaseId, resumeBaseIds: options.resumeBaseIds });

    res.json(resume);
}

export async function generateCoverLetter(req: Request, res: Response) {
    const jobId = requiredParam(req, "id");
    const options = userActionSchema.parse(req.body ?? {});
    const userId = await requireUserIdFromRequest(req, options.userId);
    const coverLetter = await generateCoverLetterForJob(jobId, { userId, resumeBaseId: options.resumeBaseId, resumeBaseIds: options.resumeBaseIds });

    res.json(coverLetter);
}

export async function generateApplicationPackage(req: Request, res: Response) {
    const jobId = requiredParam(req, "id");
    const options = userActionSchema.parse(req.body ?? {});
    const userId = await requireUserIdFromRequest(req, options.userId);
    const result = await generateApplicationPackageForJob(jobId, { userId, resumeBaseId: options.resumeBaseId, resumeBaseIds: options.resumeBaseIds });

    res.json(result);
}

export async function submitCompanyApplication(req: Request, res: Response) {
    const jobId = requiredParam(req, "id");
    const options = submitApplicationSchema.parse(req.body ?? {});
    const userId = await requireUserIdFromRequest(req, options.userId);
    const result = await submitCompanyApplicationForJob(jobId, { ...options, userId });

    res.json(result);
}
