import { Router } from "express";
import {
    authLoginSchema,
    authRefreshSchema,
    authRegisterSchema,
} from "../validation";
import {
    getUserFromAccessToken,
    loginWithPassword,
    readBearerToken,
    refreshAuthTokens,
    registerWithPassword,
    revokeRefreshToken,
} from "../services/auth.service";

export function createAuthRouter() {
    const router = Router();

    router.post("/register", async (req, res) => {
        const input = authRegisterSchema.parse(req.body ?? {});
        const result = await registerWithPassword(input);

        res.status(201).json({
            success: true,
            ...result,
        });
    });

    router.post("/login", async (req, res) => {
        const input = authLoginSchema.parse(req.body ?? {});
        const result = await loginWithPassword(input);

        res.json({
            success: true,
            ...result,
        });
    });

    router.post("/refresh", async (req, res) => {
        const input = authRefreshSchema.parse(req.body ?? {});
        const result = await refreshAuthTokens(input.refreshToken);

        res.json({
            success: true,
            ...result,
        });
    });

    router.get("/me", async (req, res) => {
        const token = readBearerToken(req.headers.authorization);
        if (!token) {
            res.status(401).json({ success: false, message: "Missing bearer token." });
            return;
        }

        const user = await getUserFromAccessToken(token);
        res.json({
            success: true,
            user,
        });
    });

    router.post("/logout", async (req, res) => {
        const input = authRefreshSchema.parse(req.body ?? {});
        await revokeRefreshToken(input.refreshToken);

        res.json({
            success: true,
        });
    });

    return router;
}
