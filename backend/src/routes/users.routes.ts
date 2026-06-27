import { Router } from "express";
import {
    createResumeBase,
    deleteResumeBase,
    getUser,
    listResumeBases,
    updateEducations,
    updateDailyAutomation,
    updateExperiences,
    updateProfile,
    updateResumeBase,
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
    router.post("/:id/resume-bases", createResumeBase);
    router.get("/:id/resume-bases", listResumeBases);
    router.put("/:id/resume-bases/:resumeBaseId", updateResumeBase);
    router.delete("/:id/resume-bases/:resumeBaseId", deleteResumeBase);

    return router;
}
