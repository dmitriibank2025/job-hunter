import { Router, RequestHandler } from "express";
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

type AuthRouterOptions = {
    writeLimiter?: RequestHandler;
    readLimiter?: RequestHandler;
};

export function createAuthRouter(opts: AuthRouterOptions = {}) {
    const router = Router();
    const { writeLimiter, readLimiter } = opts;
    const wl = writeLimiter ? [writeLimiter] : [];
    const rl = readLimiter  ? [readLimiter]  : [];

    router.post("/register", ...wl, async (req, res) => {
        const input = authRegisterSchema.parse(req.body ?? {});
        const result = await registerWithPassword(input);
        res.status(201).json({ success: true, ...result });
    });

    router.post("/login", ...wl, async (req, res) => {
        const input = authLoginSchema.parse(req.body ?? {});
        const result = await loginWithPassword(input);
        res.json({ success: true, ...result });
    });

    router.post("/refresh", ...rl, async (req, res) => {
        const input = authRefreshSchema.parse(req.body ?? {});
        const result = await refreshAuthTokens(input.refreshToken);
        res.json({ success: true, ...result });
    });

    router.get("/me", ...rl, async (req, res) => {
        const token = readBearerToken(req.headers.authorization);
        if (!token) {
            res.status(401).json({ success: false, message: "Missing bearer token." });
            return;
        }
        const user = await getUserFromAccessToken(token);
        res.json({ success: true, user });
    });

    router.post("/logout", ...wl, async (req, res) => {
        const input = authRefreshSchema.parse(req.body ?? {});
        await revokeRefreshToken(input.refreshToken);
        res.json({ success: true });
    });

    return router;
}
