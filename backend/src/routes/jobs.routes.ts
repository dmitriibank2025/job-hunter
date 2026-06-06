import { Router } from "express";
import {
    analyzeAllMissingJobs,
    analyzeOneJob,
    collectUserJobs,
    createDailyReport,
    createJob,
    createManualVacancy,
    extractManualVacancy,
    generateApplicationPackage,
    generateCoverLetter,
    generateResume,
    getAutomationStatus,
    getStatistics,
    getTopJobs,
    listCenterIsraelCompanies,
    listJobs,
    listStaticCenterIsraelCompanies,
    repairUserMatches,
    runAutomation,
    submitCompanyApplication,
    updateUserMatch,
} from "../controllers/jobs.controller";

export function createJobsRouter() {
    const router = Router();

    router.post("/", createJob);
    router.post("/manual/extract", extractManualVacancy);
    router.post("/manual", createManualVacancy);
    router.post("/collect", collectUserJobs);
    router.post("/daily-report", createDailyReport);
    router.post("/automation/run", runAutomation);
    router.get("/automation/status", getAutomationStatus);
    router.get("/center-israel/companies", listCenterIsraelCompanies);
    router.get("/center-israel/static-companies", listStaticCenterIsraelCompanies);
    router.post("/analyze-all", analyzeAllMissingJobs);
    router.post("/user-matches/repair", repairUserMatches);
    router.get("/top", getTopJobs);
    router.get("/statistics", getStatistics);
    router.get("/", listJobs);
    router.post("/:id/analyze", analyzeOneJob);
    router.put("/:id/user-match", updateUserMatch);
    router.post("/:id/generate-resume", generateResume);
    router.post("/:id/generate-cover-letter", generateCoverLetter);
    router.post("/:id/generate-application-package", generateApplicationPackage);
    router.post("/:id/submit-company-application", submitCompanyApplication);

    return router;
}
