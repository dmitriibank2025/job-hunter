import cors from "cors";
import express from "express";
import path from "path";
import { loadEnv } from "./config/env";
import { errorHandler } from "./errorHandler/error-handler";
import {
    LANGUAGE_OPTIONS,
    PLAN_LIMITS,
    TECHNOLOGY_CATALOG,
} from "./services/user-workspace.service";
import {
    createAdminRouter,
    createAuthRouter,
    createCandidateRouter,
    createEmailRouter,
    createJobsRouter,
    createStorageRouter,
    createUsersRouter,
} from "./routes";

loadEnv();

export function createApp() {
    const app = express();

    const corsOrigin = process.env.CORS_ORIGIN;
    app.use(cors({
        origin: corsOrigin
            ? corsOrigin.split(",").map((origin) => origin.trim()).filter(Boolean)
            : true,
    }));
    app.use(express.json({ limit: "2mb" }));

    app.use("/storage", createStorageRouter());

    if (process.env.SERVE_FRONTEND === "true") {
        app.use(express.static(path.join(process.cwd(), "public")));
    }

    app.get("/health", (_req, res) => {
        res.json({ status: "OK" });
    });

    app.use("/auth", createAuthRouter());
    app.use("/users", createUsersRouter());
    app.use("/admin", createAdminRouter());
    app.use("/candidate", createCandidateRouter());
    app.use("/email", createEmailRouter());
    app.use("/jobs", createJobsRouter());

    app.get("/plans", (_req, res) => {
        res.json({
            success: true,
            plans: PLAN_LIMITS,
        });
    });

    app.get("/technologies/catalog", (_req, res) => {
        res.json({
            success: true,
            technologies: TECHNOLOGY_CATALOG,
            languages: LANGUAGE_OPTIONS,
        });
    });

    app.get("/", (_req, res) => {
        if (process.env.SERVE_FRONTEND !== "true") {
            res.json({
                service: "job-hunter-api",
                status: "OK",
            });
            return;
        }

        res.sendFile(path.join(process.cwd(), "public", "index.html"));
    });

    app.use(errorHandler);

    return app;
}

export const app = createApp();
