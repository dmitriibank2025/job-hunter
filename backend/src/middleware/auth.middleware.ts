import { Request } from "express";
import { getUserFromAccessToken, readBearerToken } from "../services/auth.service";
import { HttpError } from "../errorHandler/http-error";

export async function requireAuthUser(req: Request) {
    const token = readBearerToken(req.headers.authorization);
    if (!token) throw new HttpError(401, "Missing bearer token.");

    return getUserFromAccessToken(token);
}

export async function requireUserIdFromRequest(req: Request, fallbackUserId?: string) {
    const authUser = await requireAuthUser(req);
    if (fallbackUserId && fallbackUserId !== authUser.id && authUser.role !== "ADMIN") {
        throw new HttpError(403, "You do not have access to this user's data.");
    }

    return authUser.id;
}

export async function requireUserAccess(req: Request, userId: string) {
    const authUser = await requireAuthUser(req);
    if (authUser.id !== userId && authUser.role !== "ADMIN") {
        throw new HttpError(403, "You do not have access to this user's data.");
    }
    return authUser;
}

export async function requireAdmin(req: Request) {
    const authUser = await requireAuthUser(req);
    if (authUser.role !== "ADMIN") {
        throw new HttpError(403, "Admin role is required.");
    }
    return authUser;
}
