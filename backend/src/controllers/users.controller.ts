import type { Request, Response } from "express";
import { requireUserAccess } from "../middleware/auth.middleware";
import { requiredParam } from "./request-params";
import {
    createUserResumeBase,
    deleteUserResumeBase,
    getWorkspaceUser,
    LINKEDIN_ACCOUNT_NOTICE,
    listUserResumeBases,
    registerWorkspaceUser,
    replaceUserEducations,
    replaceUserExperiences,
    replaceUserTechnologies,
    saveUploadedResume,
    updateUserResumeBase,
    upsertLinkedInAccount,
    upsertUserProfile,
} from "../services/user-workspace.service";
import {
    linkedinAccountSchema,
    registerUserSchema,
    updateUserResumeBaseSchema,
    uploadedResumeFileSchema,
    userEducationsSchema,
    userExperiencesSchema,
    userProfileSchema,
    userResumeBaseSchema,
    userTechnologySchema,
} from "../validation";

export async function registerUser(req: Request, res: Response) {
    const input = registerUserSchema.parse(req.body ?? {});
    const user = await registerWorkspaceUser(input);

    res.status(201).json({
        success: true,
        user,
    });
}

export async function getUser(req: Request, res: Response) {
    const userId = requiredParam(req, "id");
    await requireUserAccess(req, userId);
    const user = await getWorkspaceUser(userId);

    res.json({
        success: true,
        user,
    });
}

export async function updateProfile(req: Request, res: Response) {
    const userId = requiredParam(req, "id");
    await requireUserAccess(req, userId);
    const input = userProfileSchema.parse(req.body ?? {});
    const profile = await upsertUserProfile(userId, input);

    res.json({
        success: true,
        profile,
    });
}

export async function uploadResumeFile(req: Request, res: Response) {
    const userId = requiredParam(req, "id");
    await requireUserAccess(req, userId);
    const input = uploadedResumeFileSchema.parse(req.body ?? {});
    const upload = await saveUploadedResume(userId, input.fileName, input.base64Content);

    res.status(201).json({
        success: true,
        ...upload,
    });
}

export async function updateTechnologies(req: Request, res: Response) {
    const userId = requiredParam(req, "id");
    await requireUserAccess(req, userId);
    const input = userTechnologySchema.parse(req.body ?? {});
    const technologies = await replaceUserTechnologies(userId, input.technologies);

    res.json({
        success: true,
        technologies,
    });
}

export async function updateExperiences(req: Request, res: Response) {
    const userId = requiredParam(req, "id");
    await requireUserAccess(req, userId);
    const input = userExperiencesSchema.parse(req.body ?? {});
    const experiences = await replaceUserExperiences(userId, input.experiences);

    res.json({
        success: true,
        experiences,
    });
}

export async function updateEducations(req: Request, res: Response) {
    const userId = requiredParam(req, "id");
    await requireUserAccess(req, userId);
    const input = userEducationsSchema.parse(req.body ?? {});
    const educations = await replaceUserEducations(userId, input.educations);

    res.json({
        success: true,
        educations,
    });
}

export async function updateLinkedInAccount(req: Request, res: Response) {
    const userId = requiredParam(req, "id");
    await requireUserAccess(req, userId);
    const input = linkedinAccountSchema.parse(req.body ?? {});

    if (input.password) {
        res.status(400).json({
            success: false,
            message: "Raw LinkedIn passwords are not stored. Save the password in AWS Secrets Manager or another vault and provide passwordSecretRef.",
            notice: LINKEDIN_ACCOUNT_NOTICE,
        });
        return;
    }

    const account = await upsertLinkedInAccount(userId, input);

    res.json({
        success: true,
        account,
    });
}

export async function createResumeBase(req: Request, res: Response) {
    const userId = requiredParam(req, "id");
    await requireUserAccess(req, userId);
    const input = userResumeBaseSchema.parse(req.body ?? {});
    const resumeBase = await createUserResumeBase(userId, input);

    res.status(201).json({
        success: true,
        resumeBase,
    });
}

export async function listResumeBases(req: Request, res: Response) {
    const userId = requiredParam(req, "id");
    await requireUserAccess(req, userId);
    const resumeBases = await listUserResumeBases(userId);

    res.json({
        success: true,
        resumeBases,
    });
}

export async function updateResumeBase(req: Request, res: Response) {
    const userId = requiredParam(req, "id");
    const resumeBaseId = requiredParam(req, "resumeBaseId");
    await requireUserAccess(req, userId);
    const input = updateUserResumeBaseSchema.parse(req.body ?? {});
    const resumeBase = await updateUserResumeBase(userId, resumeBaseId, input);

    res.json({
        success: true,
        resumeBase,
    });
}

export async function deleteResumeBase(req: Request, res: Response) {
    const userId = requiredParam(req, "id");
    const resumeBaseId = requiredParam(req, "resumeBaseId");
    await requireUserAccess(req, userId);
    await deleteUserResumeBase(userId, resumeBaseId);

    res.status(204).send();
}
