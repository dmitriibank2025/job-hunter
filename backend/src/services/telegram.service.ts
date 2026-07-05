import { decrypt } from "../infrastructure/field-encryption.js";
import { prisma } from "../infrastructure/prisma";

const TELEGRAM_MAX_MESSAGE_LENGTH = 3900;

type TelegramConfig = { botToken: string; chatId: string };

function getGlobalTelegramConfig(): TelegramConfig | null {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!botToken || !chatId) return null;
    return { botToken, chatId };
}

export async function getUserTelegramConfig(userId: string): Promise<TelegramConfig | null> {
    const profile = await prisma.userProfile.findUnique({
        where: { userId },
        select: { telegramBotToken: true, telegramChatId: true },
    });
    if (profile?.telegramBotToken && profile?.telegramChatId) {
        return { botToken: decrypt(profile.telegramBotToken), chatId: profile.telegramChatId };
    }
    return getGlobalTelegramConfig();
}

function splitMessage(message: string): string[] {
    const chunks: string[] = [];
    let remaining = message;
    while (remaining.length > TELEGRAM_MAX_MESSAGE_LENGTH) {
        const breakpoint = remaining.lastIndexOf("\n", TELEGRAM_MAX_MESSAGE_LENGTH);
        const index = breakpoint > 0 ? breakpoint : TELEGRAM_MAX_MESSAGE_LENGTH;
        chunks.push(remaining.slice(0, index).trim());
        remaining = remaining.slice(index).trim();
    }
    if (remaining) chunks.push(remaining);
    return chunks;
}

async function sendWithConfig(config: TelegramConfig, message: string): Promise<boolean> {
    for (const chunk of splitMessage(message)) {
        const response = await fetch(
            `https://api.telegram.org/bot${config.botToken}/sendMessage`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: config.chatId,
                    text: chunk,
                    disable_web_page_preview: true,
                }),
            },
        );
        if (!response.ok) {
            const errorText = await response.text().catch(() => "");
            throw new Error(`Telegram sendMessage failed: ${response.status} ${errorText}`);
        }
    }
    return true;
}

/** Send to a specific user's Telegram (falls back to global env config if user has none). */
export async function sendTelegramMessageToUser(userId: string, message: string): Promise<boolean> {
    const config = await getUserTelegramConfig(userId);
    if (!config) {
        console.warn(`Telegram skipped for user ${userId}: no bot token or chat ID configured`);
        return false;
    }
    return sendWithConfig(config, message);
}

/** Legacy: send using global env config only. Kept for backward compatibility. */
export async function sendTelegramMessage(message: string): Promise<boolean> {
    const config = getGlobalTelegramConfig();
    if (!config) {
        console.warn("Telegram report skipped: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing");
        return false;
    }
    return sendWithConfig(config, message);
}
