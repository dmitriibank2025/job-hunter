import dotenv from "dotenv";
import fs from "fs";
import path from "path";

export function loadEnv() {
    const envPath = fs.existsSync(path.resolve(process.cwd(), ".env"))
        ? path.resolve(process.cwd(), ".env")
        : path.resolve(process.cwd(), "..", ".env");

    dotenv.config({ path: envPath });
}
