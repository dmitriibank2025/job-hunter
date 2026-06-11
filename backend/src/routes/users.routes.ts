import { Router } from "express";
import {
    createResumeBase,
    deleteResumeBase,
    getUser,
    listResumeBases,
    registerUser,
    updateEducations,
    updateDailyAutomation,
    updateExperiences,
    updateLinkedInAccount,
    updateProfile,
    updateResumeBase,
    updateTechnologies,
    uploadResumeFile,
} from "../controllers/users.controller";

export function createUsersRouter() {
    const router = Router();

    router.post("/register", registerUser);
    router.get("/:id", getUser);
    router.put("/:id/profile", updateProfile);
    router.post("/:id/resume-file", uploadResumeFile);
    router.put("/:id/technologies", updateTechnologies);
    router.put("/:id/experiences", updateExperiences);
    router.put("/:id/educations", updateEducations);
    router.put("/:id/linkedin-account", updateLinkedInAccount);
    router.put("/:id/daily-automation", updateDailyAutomation);
    router.post("/:id/resume-bases", createResumeBase);
    router.get("/:id/resume-bases", listResumeBases);
    router.put("/:id/resume-bases/:resumeBaseId", updateResumeBase);
    router.delete("/:id/resume-bases/:resumeBaseId", deleteResumeBase);

    return router;
}
