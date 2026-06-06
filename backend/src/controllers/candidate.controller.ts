import { Request, Response } from "express";
import { requireUserIdFromRequest } from "../middleware/auth.middleware";
import { buildResumeAdvice } from "../services/resume-advice.service";

export class CandidateController {
    getResumeAdvice = async (req: Request, res: Response) => {
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
    };
}
