import { NextFunction, Request, Response } from "express";
import { HttpError } from "./http-error";
import { logger } from "../Logger/logger";

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    const requestId = res.getHeader("X-Request-Id") as string | undefined;

    if (statusCode >= 500) {
        logger.error({
            requestId,
            method: req.method,
            url: req.url,
            statusCode,
            err: error instanceof Error ? { message: error.message, stack: error.stack } : error,
        }, "Unhandled server error");
    } else if (statusCode >= 400) {
        logger.warn({ requestId, method: req.method, url: req.url, statusCode, message }, "Client error");
    }

    res.status(statusCode).json({
        success: false,
        message,
    });
}
