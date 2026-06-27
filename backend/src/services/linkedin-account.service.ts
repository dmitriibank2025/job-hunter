import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { chromium, BrowserContext, Page } from "playwright";
import { prisma } from "../infrastructure/prisma";
import { ensureDir, getStorageRoot } from "./file-storage.service";

const LINKEDIN_LOGIN_URL = "https://www.linkedin.com/login";
const LINKEDIN_AUTH_TIMEOUT_MS = Number(process.env.LINKEDIN_AUTH_TIMEOUT_MS ?? 300_000);
const LINKEDIN_HEADLESS_CONNECT = process.env.LINKEDIN_CONNECT_HEADLESS !== "false";
// Empty string means "use bundled Chromium without a named channel".
// The fallback to "chrome" only applies when the variable is completely absent.
const _rawChannel = process.env.LINKEDIN_CONNECT_BROWSER_CHANNEL;
const LINKEDIN_CONNECT_BROWSER_CHANNEL = _rawChannel !== undefined && _rawChannel !== "" ? _rawChannel : undefined;
const PENDING_CONNECTION_TTL_MS = Number(process.env.LINKEDIN_PENDING_CONNECTION_TTL_MS ?? 15 * 60_000);
const STORAGE_STATE_PATTERN = /^storage\/linkedin\/[a-zA-Z0-9_-]+\.json$/;

type ConnectionStatus = "PENDING" | "CONNECTED" | "FAILED";

type PendingConnection = {
    id: string;
    userId: string;
    storageStatePath: string;
    status: ConnectionStatus;
    startedAt: Date;
    completedAt?: Date;
    error?: string;
};

const pendingConnections = new Map<string, PendingConnection>();

function nowMs() {
    return Date.now();
}

function isExpired(connection: PendingConnection) {
    return nowMs() - connection.startedAt.getTime() > PENDING_CONNECTION_TTL_MS;
}

function cleanupPendingConnections(userId?: string) {
    for (const [id, connection] of pendingConnections) {
        const shouldRemove =
            (userId ? connection.userId === userId : true) &&
            (connection.status !== "PENDING" || isExpired(connection));

        if (shouldRemove) pendingConnections.delete(id);
    }
}

export function linkedInStorageStatePathForUser(userId: string) {
    const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return `storage/linkedin/${safeUserId}.json`;
}

export function validateLinkedInStorageStatePath(storageStatePath: string) {
    const normalized = storageStatePath.replace(/\\/g, "/");

    if (
        normalized.startsWith("http") ||
        normalized.includes("..") ||
        !STORAGE_STATE_PATTERN.test(normalized)
    ) {
        throw new Error("Invalid storage state path");
    }

    return normalized;
}

export function resolveLinkedInStorageStatePath(storageStatePath: string) {
    const normalized = validateLinkedInStorageStatePath(storageStatePath);
    const relativeToStorage = normalized.replace(/^storage\//, "");
    const absolutePath = path.join(getStorageRoot(), relativeToStorage);
    const storageRoot = getStorageRoot();
    const relative = path.relative(storageRoot, absolutePath);

    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error("Invalid storage state path");
    }

    return absolutePath;
}

async function pathExists(filePath: string) {
    return fs.access(filePath).then(() => true).catch(() => false);
}

async function extractLinkedInIdentity(page: Page) {
    const pageUrl = page.url();

    const identity = await page.evaluate(() => {
        const clean = (value?: string | null) => value?.replace(/\s+/g, " ").trim() || undefined;
        const profileLink = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/in/"]'))
            .map((a) => a.href.split("?")[0])
            .find((href) => /linkedin\.com\/in\//i.test(href));
        const emailLike = clean(document.body?.innerText)?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];

        return {
            email: emailLike,
            profileUrl: profileLink,
        };
    }).catch(() => ({ email: undefined, profileUrl: undefined }));

    return {
        email: identity.email,
        profileUrl: identity.profileUrl ?? (/linkedin\.com\/in\//i.test(pageUrl) ? pageUrl.split("?")[0] : undefined),
    };
}

async function createLinkedInLoginContext(userId: string): Promise<BrowserContext> {
    const profileRoot = path.join(getStorageRoot(), "linkedin_profile", userId.replace(/[^a-zA-Z0-9_-]/g, "_"));
    await ensureDir(profileRoot);

    const launchOptions = {
        headless: LINKEDIN_HEADLESS_CONNECT,
        channel: LINKEDIN_CONNECT_BROWSER_CHANNEL,
        viewport: { width: 1440, height: 1100 },
        userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
        args: [
            "--disable-blink-features=AutomationControlled",
            "--disable-dev-shm-usage",
        ],
        ignoreDefaultArgs: ["--enable-automation"],
    } satisfies Parameters<typeof chromium.launchPersistentContext>[1];

    try {
        return await chromium.launchPersistentContext(profileRoot, launchOptions);
    } catch (error) {
        if (!LINKEDIN_CONNECT_BROWSER_CHANNEL) throw error;
        console.warn(
            `[LinkedIn] Chrome channel '${LINKEDIN_CONNECT_BROWSER_CHANNEL}' failed, falling back to bundled Chromium:`,
            error,
        );

        return chromium.launchPersistentContext(profileRoot, {
            ...launchOptions,
            channel: undefined,
        });
    }
}

async function runConnectionWatcher(connectionId: string) {
    const connection = pendingConnections.get(connectionId);
    if (!connection) return;

    let context: BrowserContext | null = null;

    try {
        const absolutePath = resolveLinkedInStorageStatePath(connection.storageStatePath);
        await ensureDir(path.dirname(absolutePath));

        context = await createLinkedInLoginContext(connection.userId);
        await context.addInitScript(() => {
            Object.defineProperty(navigator, "webdriver", { get: () => undefined });
        });
        const page = await context.newPage();

        await page.goto(LINKEDIN_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await page.waitForURL(/\/feed|\/jobs|\/mynetwork|\/in\//, {
            timeout: LINKEDIN_AUTH_TIMEOUT_MS,
        });
        await context.storageState({ path: absolutePath });

        const identity = await extractLinkedInIdentity(page);
        await prisma.userLinkedInAccount.upsert({
            where: { userId: connection.userId },
            create: {
                userId: connection.userId,
                email: identity.email,
                profileUrl: identity.profileUrl,
                storageStatePath: connection.storageStatePath,
                connectedAt: new Date(),
                isActive: true,
            },
            update: {
                email: identity.email,
                profileUrl: identity.profileUrl,
                storageStatePath: connection.storageStatePath,
                connectedAt: new Date(),
                isActive: true,
            },
        });

        connection.status = "CONNECTED";
        connection.completedAt = new Date();
    } catch (error) {
        connection.status = "FAILED";
        connection.completedAt = new Date();
        connection.error = error instanceof Error ? error.message : String(error);
        console.error("[LinkedIn] connect failed:", error);
    } finally {
        await context?.close().catch(() => undefined);
    }
}

export async function startLinkedInConnection(userId: string) {
    cleanupPendingConnections(userId);

    const existingPending = Array.from(pendingConnections.values()).find(
        (connection) => connection.userId === userId && connection.status === "PENDING" && !isExpired(connection),
    );

    if (existingPending) {
        return {
            connectionId: existingPending.id,
            storageStatePath: existingPending.storageStatePath,
        };
    }

    const connectionId = crypto.randomUUID();
    const storageStatePath = linkedInStorageStatePathForUser(userId);

    validateLinkedInStorageStatePath(storageStatePath);

    pendingConnections.set(connectionId, {
        id: connectionId,
        userId,
        storageStatePath,
        status: "PENDING",
        startedAt: new Date(),
    });

    void runConnectionWatcher(connectionId);

    return {
        connectionId,
        storageStatePath,
    };
}

export async function getLinkedInConnectionStatus(userId: string, connectionId?: string) {
    cleanupPendingConnections();

    const account = await prisma.userLinkedInAccount.findUnique({
        where: { userId },
    });
    const pending = connectionId ? pendingConnections.get(connectionId) : undefined;
    const activeAccount = account?.isActive ? account : null;

    return {
        connected: Boolean(activeAccount),
        email: activeAccount?.email ?? undefined,
        profileUrl: activeAccount?.profileUrl ?? undefined,
        connectedAt: activeAccount?.connectedAt?.toISOString(),
        lastUsedAt: activeAccount?.lastUsedAt?.toISOString(),
        connectionId: pending?.id,
        connectionStatus: pending?.status,
        error: pending?.error,
    };
}

export async function disconnectLinkedInAccount(userId: string) {
    const account = await prisma.userLinkedInAccount.findUnique({
        where: { userId },
    });

    if (account) {
        const absolutePath = resolveLinkedInStorageStatePath(account.storageStatePath);
        if (await pathExists(absolutePath)) {
            await fs.unlink(absolutePath).catch((error: unknown) => {
                console.warn("[LinkedIn] failed to delete storage state:", error);
            });
        }

        await prisma.userLinkedInAccount.update({
            where: { userId },
            data: {
                isActive: false,
                lastUsedAt: null,
            },
        });
    }

    for (const [id, pending] of pendingConnections) {
        if (pending.userId === userId) {
            pendingConnections.delete(id);
        }
    }
}
