import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { chromium } from "playwright";
import { getGlassdoorStorageStatePath } from "../providers/browser-provider-utils";

async function login() {
    const storageStatePath = getGlassdoorStorageStatePath();
    const storageDir = path.dirname(storageStatePath);
    const browserChannel = process.env.GLASSDOOR_BROWSER_CHANNEL ?? "chrome";

    await fs.mkdir(storageDir, { recursive: true });

    const context = await chromium.launchPersistentContext(storageDir, {
        headless: false,
        channel: browserChannel as "chrome" | "msedge",
        userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
        locale: "en-US",
    });
    const page = await context.newPage();

    await page.goto("https://www.glassdoor.com/", {
        waitUntil: "domcontentloaded",
        timeout: 60000,
    });

    console.log("Complete Glassdoor login with Google in the opened browser.");
    console.log("After you finish, press Enter here to save the session state.");

    await new Promise<void>((resolve) => {
        process.stdin.resume();
        process.stdin.once("data", () => resolve());
    });

    await context.storageState({ path: storageStatePath });
    await context.close();

    console.log(`Saved Glassdoor session to ${storageStatePath}`);
    console.log(`Used browser channel: ${browserChannel}`);
}

async function main() {
    const command = process.argv[2];

    if (command === "login") {
        await login();
        return;
    }

    throw new Error("Usage: pnpm glassdoor:auth");
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
