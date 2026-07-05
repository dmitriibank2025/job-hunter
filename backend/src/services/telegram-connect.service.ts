import crypto from "crypto";
import { prisma } from "../infrastructure/prisma";
import { decrypt } from "../infrastructure/field-encryption.js";
import { logger } from "../Logger/logger";

/**
 * Guided Telegram connection flow.
 *
 * Why server-side sessions instead of a self-contained signed JWT:
 *   Telegram deep-link `start` payloads are capped at 64 chars ([A-Za-z0-9_-]).
 *   Our userIds are UUIDs (36 chars), so a signed token carrying userId + exp +
 *   signature does not fit. Instead the deep link carries a random 16-byte nonce
 *   (22 base64url chars) that maps to a single-use `TelegramConnectSession` row.
 *   Security properties:
 *     - tamper-proof : the nonce is unguessable and must exist server-side
 *     - expiring     : row has expiresAt (10 min)
 *     - single-use   : row is marked consumedAt on first successful /start
 *
 * Assumption: one user = one bot. Telegram allows exactly one webhook per bot
 * token. For per-user bots, each user's bot must point its webhook at this
 * backend (registerTelegramWebhook). For the shared app bot, a single webhook
 * is registered once (operationally, out of band or via the same helper).
 */

const CONNECT_TTL_MS = 10 * 60 * 1000; // 10 minutes

type BotSource = "user_bot" | "shared_bot";

function resolveBotToken(profileToken?: string | null): { token: string; source: BotSource } | null {
    if (profileToken) return { token: decrypt(profileToken), source: "user_bot" };
    const shared = process.env.TELEGRAM_BOT_TOKEN;
    if (shared) return { token: shared, source: "shared_bot" };
    return null;
}

function webhookSecret(): string {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!secret) {
        if (process.env.NODE_ENV === "production") {
            logger.error("[FATAL] TELEGRAM_WEBHOOK_SECRET is required for the Telegram connect flow.");
        }
        return "telegram-dev-webhook-secret-change-me";
    }
    return secret;
}

export function getConfiguredWebhookSecret(): string {
    return webhookSecret();
}

/** Resolve the bot's @username via Telegram getMe. */
async function getBotUsername(token: string): Promise<string> {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`Telegram getMe failed: ${res.status} ${detail}`);
    }
    const data = (await res.json()) as { ok: boolean; result?: { username?: string } };
    if (!data.ok || !data.result?.username) {
        throw new Error("Telegram getMe returned no bot username. Check the bot token.");
    }
    return data.result.username;
}

/**
 * Register this backend as the webhook target for a (user-owned) bot.
 * Telegram allows one webhook per bot; calling setWebhook replaces any prior one.
 */
export async function registerTelegramWebhook(token: string): Promise<void> {
    const base = process.env.PUBLIC_API_BASE_URL;
    if (!base) {
        // Without a public URL we cannot register a webhook. In dev this is expected.
        logger.warn("PUBLIC_API_BASE_URL not set – skipping Telegram webhook registration.");
        return;
    }
    const url = `${base.replace(/\/$/, "")}/api/integrations/telegram/webhook/${encodeURIComponent(webhookSecret())}`;
    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, allowed_updates: ["message"] }),
    });
    if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`Telegram setWebhook failed: ${res.status} ${detail}`);
    }
    const data = (await res.json()) as { ok: boolean; description?: string };
    if (!data.ok) {
        throw new Error(`Telegram setWebhook rejected: ${data.description ?? "unknown error"}`);
    }
}

export type TelegramConnectSession = {
    connectUrl: string;
    botUsername: string;
    expiresAt: string;
    source: BotSource;
};

/**
 * Start a connect session: validate a usable bot token exists, resolve the bot
 * username, persist a single-use nonce, and return a t.me deep link.
 */
export async function createTelegramConnectSession(userId: string): Promise<TelegramConnectSession> {
    const profile = await prisma.userProfile.findUnique({
        where: { userId },
        select: { telegramBotToken: true },
    });

    const bot = resolveBotToken(profile?.telegramBotToken);
    if (!bot) {
        throw new Error("No Telegram bot token configured. Add a bot token first, or configure the shared bot.");
    }

    const botUsername = await getBotUsername(bot.token);

    // For a user-owned bot, make sure Telegram delivers /start to us.
    if (bot.source === "user_bot") {
        try {
            await registerTelegramWebhook(bot.token);
        } catch (err) {
            throw new Error(
                `Could not register the Telegram webhook for your bot: ${err instanceof Error ? err.message : "unknown error"}`,
            );
        }
    }

    const nonce = crypto.randomBytes(16).toString("base64url"); // 22 chars, well under the 64 limit
    const expiresAt = new Date(Date.now() + CONNECT_TTL_MS);

    // Invalidate any prior unconsumed sessions for this user, then create the new one.
    await prisma.$transaction([
        prisma.telegramConnectSession.deleteMany({ where: { userId, consumedAt: null } }),
        prisma.telegramConnectSession.create({
            data: { nonce, userId, source: bot.source, expiresAt },
        }),
    ]);

    return {
        connectUrl: `https://t.me/${botUsername}?start=${nonce}`,
        botUsername,
        expiresAt: expiresAt.toISOString(),
        source: bot.source,
    };
}

/**
 * Verify and consume a connect nonce, binding the Telegram chat to the user.
 * Returns the bound userId, or throws on invalid/expired/replayed nonce.
 */
export async function consumeTelegramConnectNonce(nonce: string, chat: {
    chatId: string;
    username?: string | null;
    firstName?: string | null;
}): Promise<string> {
    const session = await prisma.telegramConnectSession.findUnique({ where: { nonce } });
    if (!session) throw new Error("Unknown Telegram connect token.");
    if (session.consumedAt) throw new Error("Telegram connect token already used.");
    if (session.expiresAt.getTime() < Date.now()) throw new Error("Telegram connect token expired.");

    // Bind chat to the user and mark the session consumed in one transaction.
    await prisma.$transaction([
        prisma.userProfile.update({
            where: { userId: session.userId },
            data: {
                telegramChatId: chat.chatId,
                telegramUsername: chat.username ?? null,
                telegramFirstName: chat.firstName ?? null,
                telegramConnectedAt: new Date(),
            },
        }),
        prisma.telegramConnectSession.update({
            where: { id: session.id },
            data: { consumedAt: new Date() },
        }),
    ]);

    return session.userId;
}

/** Send a one-off confirmation reply after a successful connect. */
export async function sendTelegramConfirmation(userId: string, chatId: string): Promise<void> {
    const profile = await prisma.userProfile.findUnique({
        where: { userId },
        select: { telegramBotToken: true },
    });
    const bot = resolveBotToken(profile?.telegramBotToken);
    if (!bot) return;
    await fetch(`https://api.telegram.org/bot${bot.token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            chat_id: chatId,
            text: "✅ Telegram connected to Job Hunter. You'll receive your job reports here.",
            disable_web_page_preview: true,
        }),
    }).catch(() => undefined);
}

export type TelegramStatus = {
    connected: boolean;
    pending: boolean;
    hasBotToken: boolean;
    usingSharedBot: boolean;
    telegramUsername?: string | null;
    telegramFirstName?: string | null;
    connectedAt?: string | null;
};

export async function getTelegramStatus(userId: string): Promise<TelegramStatus> {
    const profile = await prisma.userProfile.findUnique({
        where: { userId },
        select: {
            telegramBotToken: true,
            telegramChatId: true,
            telegramUsername: true,
            telegramFirstName: true,
            telegramConnectedAt: true,
        },
    });

    const hasUserBot = Boolean(profile?.telegramBotToken);
    const usingSharedBot = !hasUserBot && Boolean(process.env.TELEGRAM_BOT_TOKEN);
    const connected = Boolean(profile?.telegramChatId);

    const pendingSession = !connected
        ? await prisma.telegramConnectSession.findFirst({
            where: { userId, consumedAt: null, expiresAt: { gt: new Date() } },
        })
        : null;

    return {
        connected,
        pending: Boolean(pendingSession),
        hasBotToken: hasUserBot,
        usingSharedBot,
        telegramUsername: profile?.telegramUsername ?? null,
        telegramFirstName: profile?.telegramFirstName ?? null,
        connectedAt: profile?.telegramConnectedAt?.toISOString() ?? null,
    };
}

/** Disconnect Telegram: clear chat binding + metadata. Keeps the bot token
 * (consistent with how other integration credentials are retained until the
 * user explicitly changes them). */
export async function disconnectTelegram(userId: string): Promise<void> {
    await prisma.$transaction([
        prisma.userProfile.update({
            where: { userId },
            data: {
                telegramChatId: null,
                telegramUsername: null,
                telegramFirstName: null,
                telegramConnectedAt: null,
            },
        }),
        prisma.telegramConnectSession.deleteMany({ where: { userId } }),
    ]);
}

/** Parse a Telegram webhook update and, if it's a `/start <nonce>`, bind it. */
export async function handleTelegramWebhookUpdate(update: unknown): Promise<void> {
    const msg = (update as { message?: {
        text?: string;
        chat?: { id?: number | string };
        from?: { username?: string; first_name?: string };
    } })?.message;

    const text = msg?.text?.trim();
    const chatId = msg?.chat?.id;
    if (!text || chatId === undefined || chatId === null) return;

    const match = /^\/start\s+(\S+)$/.exec(text);
    if (!match) return;

    const nonce = match[1];
    try {
        const userId = await consumeTelegramConnectNonce(nonce, {
            chatId: String(chatId),
            username: msg?.from?.username,
            firstName: msg?.from?.first_name,
        });
        await sendTelegramConfirmation(userId, String(chatId));
        logger.info({ userId }, "[Telegram] chat connected via /start");
    } catch (err) {
        logger.warn({ err: err instanceof Error ? err.message : err }, "[Telegram] connect /start rejected");
    }
}
