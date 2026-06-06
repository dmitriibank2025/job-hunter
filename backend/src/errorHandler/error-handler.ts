import { NextFunction, Request, Response } from "express";
import { HttpError } from "./http-error";
import { logger } from "../Logger/logger";

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    if (statusCode >= 500) {
        logger.error(error);
    }

    res.status(statusCode).json({
        success: false,
        message,
    });
}
