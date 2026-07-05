/**
 * Telegram guided-connect flow: session creation, nonce consumption, replay,
 * expiry, webhook binding, and disconnect.
 *
 * Prisma is mocked with a tiny in-memory store so we test real service logic
 * (validation, single-use, expiry, chat binding) without a database.
 */

type Session = {
    id: string;
    nonce: string;
    userId: string;
    source: string;
    issuedAt: Date;
    expiresAt: Date;
    consumedAt: Date | null;
};

const sessions: Session[] = [];
const profiles: Record<string, any> = {};

function resetStore() {
    sessions.length = 0;
    for (const k of Object.keys(profiles)) delete profiles[k];
}

jest.mock("../infrastructure/prisma", () => ({
    prisma: {
        $transaction: (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]),
        userProfile: {
            findUnique: ({ where }: any) =>
                Promise.resolve(profiles[where.userId] ?? null),
            update: ({ where, data }: any) => {
                profiles[where.userId] = { ...(profiles[where.userId] ?? { userId: where.userId }), ...data };
                return Promise.resolve(profiles[where.userId]);
            },
        },
        telegramConnectSession: {
            findUnique: ({ where }: any) =>
                Promise.resolve(sessions.find((s) => s.nonce === where.nonce) ?? null),
            findFirst: ({ where }: any) =>
                Promise.resolve(
                    sessions.find((s) =>
                        s.userId === where.userId &&
                        s.consumedAt === null &&
                        (!where.expiresAt || s.expiresAt.getTime() > Date.now()),
                    ) ?? null,
                ),
            create: ({ data }: any) => {
                const row: Session = {
                    id: `s${sessions.length + 1}`,
                    nonce: data.nonce,
                    userId: data.userId,
                    source: data.source,
                    issuedAt: new Date(),
                    expiresAt: data.expiresAt,
                    consumedAt: null,
                };
                sessions.push(row);
                return Promise.resolve(row);
            },
            update: ({ where, data }: any) => {
                const row = sessions.find((s) => s.id === where.id);
                if (row) Object.assign(row, data);
                return Promise.resolve(row);
            },
            deleteMany: ({ where }: any) => {
                for (let i = sessions.length - 1; i >= 0; i--) {
                    const s = sessions[i];
                    if (s.userId === where.userId && (where.consumedAt === undefined || s.consumedAt === where.consumedAt)) {
                        sessions.splice(i, 1);
                    }
                }
                return Promise.resolve({ count: 0 });
            },
        },
    },
}));

jest.mock("../infrastructure/field-encryption.js", () => ({
    decrypt: (v: string) => v,
}));

jest.mock("../Logger/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// Mock global fetch (getMe / setWebhook / sendMessage)
const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

import {
    createTelegramConnectSession,
    handleTelegramWebhookUpdate,
    consumeTelegramConnectNonce,
    getTelegramStatus,
    disconnectTelegram,
} from "../services/telegram-connect.service";

beforeEach(() => {
    resetStore();
    fetchMock.mockReset();
    process.env.TELEGRAM_BOT_TOKEN = "111:SHARED";
    delete process.env.PUBLIC_API_BASE_URL; // skip webhook registration in tests
});

function mockGetMe(username = "JobHunterBot") {
    fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, result: { username } }),
    });
}

describe("createTelegramConnectSession", () => {
    it("creates a connect URL with a nonce and stores a session", async () => {
        profiles["u1"] = { userId: "u1", telegramBotToken: "222:USERBOT" };
        mockGetMe("MyUserBot");

        const session = await createTelegramConnectSession("u1");

        expect(session.botUsername).toBe("MyUserBot");
        expect(session.connectUrl).toMatch(/^https:\/\/t\.me\/MyUserBot\?start=/);
        const nonce = session.connectUrl.split("start=")[1];
        expect(nonce.length).toBeLessThanOrEqual(64);
        expect(sessions.find((s) => s.nonce === nonce)).toBeTruthy();
    });

    it("uses the shared bot when the user has no token", async () => {
        profiles["u2"] = { userId: "u2", telegramBotToken: null };
        mockGetMe("SharedBot");
        const session = await createTelegramConnectSession("u2");
        expect(session.source).toBe("shared_bot");
    });

    it("throws when no bot token is available anywhere", async () => {
        delete process.env.TELEGRAM_BOT_TOKEN;
        profiles["u3"] = { userId: "u3", telegramBotToken: null };
        await expect(createTelegramConnectSession("u3")).rejects.toThrow(/No Telegram bot token/);
    });
});

describe("consumeTelegramConnectNonce", () => {
    async function seedSession(userId: string) {
        profiles[userId] = { userId, telegramBotToken: null };
        mockGetMe();
        const s = await createTelegramConnectSession(userId);
        return s.connectUrl.split("start=")[1];
    }

    it("binds chat_id to the correct user (round-trip)", async () => {
        const nonce = await seedSession("u1");
        const boundUser = await consumeTelegramConnectNonce(nonce, { chatId: "9001", username: "yuki", firstName: "Yuki" });
        expect(boundUser).toBe("u1");
        expect(profiles["u1"].telegramChatId).toBe("9001");
        expect(profiles["u1"].telegramUsername).toBe("yuki");
    });

    it("rejects an unknown (tampered) nonce", async () => {
        await expect(consumeTelegramConnectNonce("bogus", { chatId: "1" })).rejects.toThrow(/Unknown/);
    });

    it("rejects a replayed nonce (already consumed)", async () => {
        const nonce = await seedSession("u1");
        await consumeTelegramConnectNonce(nonce, { chatId: "9001" });
        await expect(consumeTelegramConnectNonce(nonce, { chatId: "9999" })).rejects.toThrow(/already used/);
    });

    it("rejects an expired nonce", async () => {
        const nonce = await seedSession("u1");
        // force-expire
        const row = sessions.find((s) => s.nonce === nonce)!;
        row.expiresAt = new Date(Date.now() - 1000);
        await expect(consumeTelegramConnectNonce(nonce, { chatId: "9001" })).rejects.toThrow(/expired/);
    });
});

describe("handleTelegramWebhookUpdate", () => {
    it("binds chat on a /start <nonce> message", async () => {
        profiles["u1"] = { userId: "u1", telegramBotToken: null };
        mockGetMe();
        const s = await createTelegramConnectSession("u1");
        const nonce = s.connectUrl.split("start=")[1];

        // getMe-less path: confirmation sendMessage is mocked to succeed
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });

        await handleTelegramWebhookUpdate({
            message: { text: `/start ${nonce}`, chat: { id: 5005 }, from: { username: "yuki", first_name: "Yuki" } },
        });

        expect(profiles["u1"].telegramChatId).toBe("5005");
    });

    it("ignores non-start messages", async () => {
        await handleTelegramWebhookUpdate({ message: { text: "hello", chat: { id: 1 } } });
        // nothing to assert beyond no throw / no binding
        expect(Object.keys(profiles)).toHaveLength(0);
    });
});

describe("status + disconnect", () => {
    it("reports connected then not-connected after disconnect", async () => {
        profiles["u1"] = {
            userId: "u1",
            telegramBotToken: "222:USERBOT",
            telegramChatId: "9001",
            telegramUsername: "yuki",
            telegramConnectedAt: new Date(),
        };

        let status = await getTelegramStatus("u1");
        expect(status.connected).toBe(true);
        expect(status.telegramUsername).toBe("yuki");

        await disconnectTelegram("u1");
        status = await getTelegramStatus("u1");
        expect(status.connected).toBe(false);
        expect(profiles["u1"].telegramChatId).toBeNull();
    });
});
