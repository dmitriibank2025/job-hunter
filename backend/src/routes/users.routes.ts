import { Router } from "express";
import {
    addCompanyToBlacklist,
    createResumeBase,
    deleteCompanyFromBlacklist,
    deleteResumeBase,
    getCompanyBlacklist,
    getUser,
    listResumeBases,
    updateDailyAutomation,
    updateEducations,
    updateExperiences,
    updateProfile,
    updateResumeBase,
    updateSearchSettings,
    updateTechnologies,
    uploadResumeFile,
} from "../controllers/users.controller";

export function createUsersRouter() {
    const router = Router();

    router.get("/:id", getUser);
    router.put("/:id/profile", updateProfile);
    router.post("/:id/resume-file", uploadResumeFile);
    router.put("/:id/technologies", updateTechnologies);
    router.put("/:id/experiences", updateExperiences);
    router.put("/:id/educations", updateEducations);
    router.put("/:id/daily-automation", updateDailyAutomation);
    router.put("/:id/search-settings", updateSearchSettings);
    router.get("/:id/blacklist", getCompanyBlacklist);
    router.post("/:id/blacklist", addCompanyToBlacklist);
    router.delete("/:id/blacklist/:companyId", deleteCompanyFromBlacklist);
    router.post("/:id/resume-bases", createResumeBase);
    router.get("/:id/resume-bases", listResumeBases);
    router.put("/:id/resume-bases/:resumeBaseId", updateResumeBase);
    router.delete("/:id/resume-bases/:resumeBaseId", deleteResumeBase);

    return router;
}
