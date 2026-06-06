const TELEGRAM_MAX_MESSAGE_LENGTH = 3900;

function getTelegramConfig() {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!botToken || !chatId) {
        return null;
    }

    return {
        botToken,
        chatId,
    };
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

    if (remaining) {
        chunks.push(remaining);
    }

    return chunks;
}

export async function sendTelegramMessage(message: string): Promise<boolean> {
    const config = getTelegramConfig();

    if (!config) {
        console.warn("Telegram report skipped: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing");
        return false;
    }

    for (const chunk of splitMessage(message)) {
        const response = await fetch(
            `https://api.telegram.org/bot${config.botToken}/sendMessage`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
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
