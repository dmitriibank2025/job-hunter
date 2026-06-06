import { z } from "zod";
import { LANGUAGE_OPTIONS } from "../services/user-workspace.service";

export const createJobSchema = z.object({
    title: z.string().min(2),
    company: z.string().optional(),
    location: z.string().optional(),
    url: z.string().url().optional(),
    postedAt: z.coerce.date().optional(),
    source: z.string().optional(),
    description: z.string().min(50),
});

export const manualVacancySchema = z.object({
    title: z.string().trim().min(2).optional(),
    company: z.string().trim().min(1).optional(),
    location: z.string().trim().min(1).optional(),
    url: z.string().trim().url().optional(),
    description: z.string().trim().optional(),
    userId: z.string().trim().uuid().optional(),
    resumeBaseId: z.string().trim().uuid().optional(),
}).refine(
    (data) => Boolean(data.url) || Boolean(data.description && data.description.length >= 50),
    { message: "Provide either a vacancy URL or at least 50 characters of vacancy text." },
);

export const manualVacancyExtractSchema = z.object({
    url: z.string().trim().url(),
});

export const submitApplicationSchema = z.object({
    userId: z.string().trim().uuid().optional(),
    autoSubmit: z.boolean().optional(),
    headless: z.boolean().optional(),
});

export const uploadResumeSchema = z.object({
    resume: z.string().min(100),
});

export const automationRunSchema = z.object({
    userId: z.string().trim().uuid().optional(),
    resumeBaseId: z.string().trim().uuid().optional(),
    searchLocation: z.string().min(2).optional(),
    sourceMode: z.enum(["EMAIL", "PROVIDERS", "CENTER_ISRAEL"]).optional(),
    preferences: z.object({
        targetRoles: z.array(z.string()).optional(),
        targetLocations: z.array(z.string()).optional(),
        requiredTech: z.array(z.string()).optional(),
        excludedKeywords: z.array(z.string()).optional(),
        dateRangeDays: z.coerce.number().int().positive().optional(),
        minMatchScore: z.coerce.number().min(0).max(100).optional(),
    }).optional(),
});

export const registerUserSchema = z.object({
    email: z.string().trim().email(),
    fullName: z.string().trim().min(2).optional(),
    password: z.string().min(8).optional(),
    plan: z.enum(["FREE", "PRO"]).optional(),
    role: z.enum(["USER", "ADMIN"]).optional(),
});

export const authRegisterSchema = z.object({
    email: z.string().trim().email(),
    password: z.string().min(8),
    fullName: z.string().trim().min(2).optional(),
    plan: z.enum(["FREE", "PRO"]).optional(),
});

export const authLoginSchema = z.object({
    email: z.string().trim().email(),
    password: z.string().min(1),
});

export const authRefreshSchema = z.object({
    refreshToken: z.string().min(20),
});

export const userProfileSchema = z.object({
    fullName: z.string().trim().min(2),
    email: z.string().trim().email(),
    location: z.string().trim().optional(),
    phone: z.string().trim().optional(),
    linkedin: z.string().trim().optional(),
    github: z.string().trim().optional(),
    portfolio: z.string().trim().optional(),
    languages: z.array(z.enum(LANGUAGE_OPTIONS)).default([]),
    summary: z.string().trim().optional(),
});

export const userTechnologySchema = z.object({
    technologies: z.array(z.object({
        name: z.string().trim().min(1),
        category: z.string().trim().optional(),
        level: z.string().trim().optional(),
    })).default([]),
});

export const userExperiencesSchema = z.object({
    experiences: z.array(z.object({
        company: z.string().trim().min(1),
        title: z.string().trim().min(1),
        location: z.string().trim().optional(),
        startDate: z.string().trim().min(1),
        endDate: z.string().trim().optional(),
        project: z.string().trim().optional(),
        description: z.string().trim().optional(),
        bullets: z.array(z.string().trim()).default([]),
        technologies: z.array(z.string().trim()).default([]),
        sortOrder: z.coerce.number().int().optional(),
    })).default([]),
});

export const userEducationsSchema = z.object({
    educations: z.array(z.object({
        institution: z.string().trim().min(1),
        program: z.string().trim().min(1),
        location: z.string().trim().optional(),
        startDate: z.string().trim().optional(),
        endDate: z.string().trim().optional(),
        details: z.array(z.string().trim()).default([]),
        sortOrder: z.coerce.number().int().optional(),
    })).default([]),
});

export const userResumeBaseSchema = z.object({
    name: z.string().trim().min(2),
    target: z.enum(["FRONTEND", "BACKEND", "FULLSTACK", "CUSTOM"]).optional(),
    targetTitle: z.string().trim().optional(),
    isDefault: z.boolean().optional(),
    template: z.enum(["ATS", "MODERN", "COMPACT"]).optional(),
});

export const updateUserResumeBaseSchema = z.object({
    name: z.string().trim().min(2).optional(),
    target: z.enum(["FRONTEND", "BACKEND", "FULLSTACK", "CUSTOM"]).optional(),
    targetTitle: z.string().trim().nullable().optional(),
    content: z.string().trim().min(50).optional(),
    isDefault: z.boolean().optional(),
    template: z.enum(["ATS", "MODERN", "COMPACT"]).optional(),
});

export const linkedinAccountSchema = z.object({
    email: z.string().trim().email(),
    passwordSecretRef: z.string().trim().optional(),
    storageStatePath: z.string().trim().optional(),
    note: z.string().trim().optional(),
    password: z.string().optional(),
});

export const userActionSchema = z.object({
    userId: z.string().trim().uuid().optional(),
    resumeBaseId: z.string().trim().uuid().optional(),
});

export const uploadedResumeFileSchema = z.object({
    fileName: z.string().trim().min(1).regex(/\.(pdf|docx)$/i, "Upload a PDF or DOCX file."),
    base64Content: z.string().min(100),
});

export const userJobMatchSchema = z.object({
    userId: z.string().trim().uuid().optional(),
    status: z.enum(["NEW", "ANALYZED", "SAVED", "REJECTED", "APPLIED", "IGNORED"]).optional(),
    matchScore: z.coerce.number().int().min(0).max(100).optional(),
    analysis: z.unknown().optional(),
    applied: z.boolean().optional(),
    ignored: z.boolean().optional(),
    notes: z.string().trim().optional(),
});
