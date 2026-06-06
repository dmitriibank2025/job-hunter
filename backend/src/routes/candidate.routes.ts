import { Router } from "express";
import { CandidateController } from "../controllers/candidate.controller";

export function createCandidateRouter() {
    const router = Router();
    const controller = new CandidateController();

    router.get("/resume/advice", controller.getResumeAdvice);

    return router;
}
