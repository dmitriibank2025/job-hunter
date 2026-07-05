import dotenv from "dotenv";
import fs from "fs";
import path from "path";

export function loadEnv() {
    const envPath = fs.existsSync(path.resolve(process.cwd(), ".env"))
        ? path.resolve(process.cwd(), ".env")
        : path.resolve(process.cwd(), "..", ".env");

    dotenv.config({ path: envPath });
}

const REQUIRED_IN_PRODUCTION: string[] = [
    "AUTH_TOKEN_SECRET",
    "CORS_ORIGIN",
    "DATABASE_URL",
];

export function validateEnv() {
    if (process.env.NODE_ENV !== "production") return;

    const missing = REQUIRED_IN_PRODUCTION.filter((key) => !process.env[key]);
    if (missing.length > 0) {
        console.error(`[FATAL] Missing required environment variables in production: ${missing.join(", ")}`);
        process.exit(1);
    }

    const secret = process.env.AUTH_TOKEN_SECRET ?? "";
    if (secret.length < 32) {
        console.error("[FATAL] AUTH_TOKEN_SECRET must be at least 32 characters.");
        process.exit(1);
    }
}
