import { Router } from "express";
import { BASE_RESUME } from "../data/base-resume";
import { prisma } from "../infrastructure/prisma";
import { requireUserIdFromRequest } from "../middleware/auth.middleware";
import { buildResumeAdvice } from "../services/resume-advice.service";
import { uploadResumeSchema } from "../validation";

function defaultCandidateProfile(resume = BASE_RESUME) {
    return {
        fullName: process.env.DEFAULT_CANDIDATE_FULL_NAME ?? "Candidate",
        email: process.env.DEFAULT_CANDIDATE_EMAIL ?? "candidate@example.com",
        linkedin: process.env.DEFAULT_CANDIDATE_LINKEDIN,
        github: process.env.DEFAULT_CANDIDATE_GITHUB,
        resume,
    };
}

export function createCandidateRouter() {
    const router = Router();

    router.post("/seed", async (_req, res) => {
        if (process.env.NODE_ENV === "production" && process.env.ENABLE_SEED_ENDPOINT !== "true") {
            res.status(403).json({
                success: false,
                message: "Candidate seed endpoint is disabled in production.",
            });
            return;
        }

        const profile = await prisma.candidateProfile.create({
            data: defaultCandidateProfile(),
        });

        res.status(201).json(profile);
    });

    router.post("/resume", async (req, res) => {
        const data = uploadResumeSchema.parse(req.body);
        const existing = await prisma.candidateProfile.findFirst({
            orderBy: { createdAt: "desc" },
        });

        const profile = existing
            ? await prisma.candidateProfile.update({
                where: { id: existing.id },
                data: {
                    resume: data.resume,
                },
            })
            : await prisma.candidateProfile.create({
                data: defaultCandidateProfile(data.resume),
            });

        res.status(existing ? 200 : 201).json(profile);
    });

    router.get("/resume/advice", async (req, res) => {
        const limit = Number(req.query.limit ?? 300);
        const minMatchScore = Number(req.query.minMatchScore ?? 70);
        const userId = await requireUserIdFromRequest(
            req,
            typeof req.query.userId === "string" ? req.query.userId : undefined,
        );
        const advice = await buildResumeAdvice({
            userId,
            limit: Number.isFinite(limit) && limit > 0 ? limit : 300,
            minMatchScore: Number.isFinite(minMatchScore) ? minMatchScore : 70,
        });

        res.json({
            success: true,
            advice,
        });
    });

    return router;
}
