import { Router, RequestHandler } from "express";
import {
    analyzeAllMissingJobs,
    analyzeOneJob,
    createDailyReport,
    createManualVacancy,
    extractManualVacancy,
    generateApplicationPackage,
    generateCoverLetter,
    generateResume,
    getRejectionsResumeReport,
    getAutomationStatus,
    getStatistics,
    getTopJobs,
    listCenterIsraelCompanies,
    listJobs,
    refinePromptRules,
    repairUserMatches,
    runAutomation,
    sendTelegramNotification,
    submitCompanyApplication,
    updateUserMatch,
} from "../controllers/jobs.controller";

type JobsRouterOptions = {
    automationLimiter?: RequestHandler;
    generationLimiter?: RequestHandler;
    scrapingLimiter?: RequestHandler;
    apiLimiter?: RequestHandler;
};

const noop: RequestHandler[] = [];

export function createJobsRouter(opts: JobsRouterOptions = {}) {
    const router = Router();
    const auto = opts.automationLimiter ? [opts.automationLimiter] : noop;
    const gen  = opts.generationLimiter ? [opts.generationLimiter] : noop;
    const scrp = opts.scrapingLimiter   ? [opts.scrapingLimiter]   : noop;
    const api  = opts.apiLimiter        ? [opts.apiLimiter]        : noop;

    // Dashboard reads — general API limit
    router.get("/", ...api, listJobs);
    router.get("/top", ...api, getTopJobs);
    router.get("/statistics", ...api, getStatistics);
    router.get("/automation/status", ...api, getAutomationStatus);
    router.get("/center-israel/companies", ...api, listCenterIsraelCompanies);
    router.get("/rejections/resume-report", ...api, getRejectionsResumeReport);

    // Lightweight writes — general API limit
    router.put("/:id/user-match", ...api, updateUserMatch);
    router.post("/notifications/telegram", ...api, sendTelegramNotification);
    router.post("/user-matches/repair", ...api, repairUserMatches);

    // Manual vacancy (URL extraction/creation) — scraping limit
    router.post("/manual/extract", ...scrp, extractManualVacancy);
    router.post("/manual", ...scrp, createManualVacancy);

    // Full automation run — strictest limit
    router.post("/automation/run", ...auto, runAutomation);
    router.post("/daily-report", ...auto, createDailyReport);

    // OpenAI-backed — generation limit
    router.post("/:id/analyze", ...gen, analyzeOneJob);
    router.post("/analyze-all", ...gen, analyzeAllMissingJobs);
    router.post("/rejections/refine", ...gen, refinePromptRules);
    router.post("/:id/generate-resume", ...gen, generateResume);
    router.post("/:id/generate-cover-letter", ...gen, generateCoverLetter);
    router.post("/:id/generate-application-package", ...gen, generateApplicationPackage);
    router.post("/:id/submit-company-application", ...scrp, submitCompanyApplication);

    return router;
}
