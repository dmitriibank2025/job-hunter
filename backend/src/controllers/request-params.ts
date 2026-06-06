import type { Request } from "express";

export function requiredParam(req: Request, name: string): string {
    const value = req.params[name];

    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`Missing route parameter: ${name}`);
    }

    return value;
}
