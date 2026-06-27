import { prisma } from "../infrastructure/prisma";

type GmailConfig = {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    userId: string;
    appUserId?: string;
};

const GMAIL_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
];

type GmailListResponse = {
    messages?: Array<{
        id: string;
        threadId: string;
    }>;
    nextPageToken?: string;
};

type GmailHeader = {
    name: string;
    value: string;
};

type GmailMessagePart = {
    mimeType?: string;
    filename?: string;
    body?: {
        data?: string;
    };
    parts?: GmailMessagePart[];
};

export type GmailMessage = {
    id: string;
    threadId?: string;
    labelIds?: string[];
    snippet?: string;
    internalDate?: string;
    payload?: GmailMessagePart & {
        headers?: GmailHeader[];
    };
};

export type ParsedGmailMessage = {
    id: string;
    threadId?: string;
    labels: string[];
    subject: string;
    from?: string;
    snippet?: string;
    bodyText?: string;
    emailTs: Date;
    raw: GmailMessage;
};

function gmailRedirectUri(): string {
    return process.env.GMAIL_REDIRECT_URI ?? "http://localhost:4000/email/gmail/callback";
}

function getGmailClientEnv() {
    const clientId = process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        return null;
    }

    return {
        clientId,
        clientSecret,
    };
}

async function getGmailConfig(userId?: string): Promise<GmailConfig | null> {
    const client = getGmailClientEnv();
    if (!client) return null;

    if (userId) {
        const account = await prisma.userGmailAccount.findUnique({
            where: { userId },
        });

        if (account?.isActive && account.refreshToken) {
            return {
                ...client,
                refreshToken: account.refreshToken,
                userId: account.googleUserId || "me",
                appUserId: userId,
            };
        }
    }

    const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
    if (!refreshToken) return null;

    return {
        ...client,
        refreshToken,
        userId: process.env.GMAIL_USER_ID ?? "me",
    };
}

export async function isGmailConfigured(userId?: string): Promise<boolean> {
    return getGmailConfig(userId) !== null;
}

export function buildGmailAuthUrl(userId: string): string {
    const client = getGmailClientEnv();
    if (!client) {
        throw new Error("GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET are required.");
    }

    const state = Buffer.from(JSON.stringify({ userId }), "utf8").toString("base64url");
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");

    url.searchParams.set("client_id", client.clientId);
    url.searchParams.set("redirect_uri", gmailRedirectUri());
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", GMAIL_SCOPES.join(" "));
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);

    return url.toString();
}

function userIdFromOAuthState(state?: string | null): string {
    if (!state) throw new Error("Missing OAuth state.");

    try {
        const decoded = JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as { userId?: string };
        if (!decoded.userId) throw new Error("Missing userId in OAuth state.");
        return decoded.userId;
    } catch {
        throw new Error("Invalid OAuth state.");
    }
}

async function fetchGmailProfile(accessToken: string, googleUserId = "me"): Promise<{ emailAddress?: string }> {
    return gmailFetch<{ emailAddress?: string }>(
        `/users/${encodeURIComponent(googleUserId)}/profile`,
        accessToken,
    );
}

export async function connectGmailFromOAuthCallback(input: {
    code: string;
    state?: string | null;
}) {
    const client = getGmailClientEnv();
    if (!client) {
        throw new Error("GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET are required.");
    }

    const userId = userIdFromOAuthState(input.state);
    const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
            client_id: client.clientId,
            client_secret: client.clientSecret,
            code: input.code,
            redirect_uri: gmailRedirectUri(),
            grant_type: "authorization_code",
        }),
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`Gmail OAuth code exchange failed: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as {
        refresh_token?: string;
        access_token?: string;
        scope?: string;
    };

    if (!data.refresh_token) {
        throw new Error("Google did not return a refresh token. Reconnect Gmail and approve offline access.");
    }

    const profile: { emailAddress?: string } = data.access_token
        ? await fetchGmailProfile(data.access_token).catch(() => ({}))
        : {};
    const scopes = data.scope?.split(/\s+/).filter(Boolean) ?? GMAIL_SCOPES;

    return prisma.userGmailAccount.upsert({
        where: { userId },
        create: {
            userId,
            email: profile.emailAddress,
            googleUserId: "me",
            refreshToken: data.refresh_token,
            scopes,
            connectedAt: new Date(),
            isActive: true,
            lastError: null,
        },
        update: {
            email: profile.emailAddress,
            googleUserId: "me",
            refreshToken: data.refresh_token,
            scopes,
            connectedAt: new Date(),
            isActive: true,
            lastError: null,
        },
    });
}

export async function getGmailConnectionStatus(userId: string) {
    const account = await prisma.userGmailAccount.findUnique({
        where: { userId },
        select: {
            email: true,
            googleUserId: true,
            scopes: true,
            connectedAt: true,
            lastUsedAt: true,
            lastError: true,
            isActive: true,
        },
    });

    return {
        configured: Boolean(getGmailClientEnv()),
        connected: Boolean(account?.isActive),
        account,
        envFallbackConfigured: Boolean(process.env.GMAIL_REFRESH_TOKEN && getGmailClientEnv()),
    };
}

async function getAccessToken(config: GmailConfig): Promise<string> {
    const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            refresh_token: config.refreshToken,
            grant_type: "refresh_token",
        }),
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        if (config.appUserId) {
            await prisma.userGmailAccount.update({
                where: { userId: config.appUserId },
                data: { lastError: `Gmail token refresh failed: ${response.status} ${errorText}`.slice(0, 1_000) },
            }).catch(() => undefined);
        }
        throw new Error(`Gmail token refresh failed: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as { access_token?: string };

    if (!data.access_token) {
        throw new Error("Gmail token refresh did not return access_token");
    }

    return data.access_token;
}

async function gmailFetch<T>(path: string, accessToken: string): Promise<T> {
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1${path}`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`Gmail API failed: ${response.status} ${errorText}`);
    }

    return (await response.json()) as T;
}

function decodeBase64Url(value: string): string {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=");

    return Buffer.from(padded, "base64").toString("utf8");
}

function collectTextParts(part?: GmailMessagePart): string[] {
    if (!part) return [];

    const nested = part.parts?.flatMap(collectTextParts) ?? [];
    const data = part.body?.data;

    if (!data || part.mimeType !== "text/plain") {
        return nested;
    }

    return [decodeBase64Url(data), ...nested];
}

function headerValue(message: GmailMessage, name: string): string | undefined {
    const headers = message.payload?.headers ?? [];
    const header = headers.find((item) => item.name.toLowerCase() === name.toLowerCase());

    return header?.value;
}

function parseGmailMessage(message: GmailMessage): ParsedGmailMessage {
    const bodyText = collectTextParts(message.payload).join("\n").trim();
    const internalDate = message.internalDate ? Number(message.internalDate) : Date.now();

    return {
        id: message.id,
        threadId: message.threadId,
        labels: message.labelIds ?? [],
        subject: headerValue(message, "Subject") ?? "(no subject)",
        from: headerValue(message, "From"),
        snippet: message.snippet,
        bodyText: bodyText || message.snippet,
        emailTs: Number.isFinite(internalDate) ? new Date(internalDate) : new Date(),
        raw: message,
    };
}

export async function searchGmailMessages(query: string, maxResults?: number): Promise<ParsedGmailMessage[]> {
    return searchGmailMessagesForUser(undefined, query, maxResults);
}

export async function searchGmailMessagesForUser(userId: string | undefined, query: string, maxResults?: number): Promise<ParsedGmailMessage[]> {
    const config = await getGmailConfig(userId);

    if (!config) {
        return [];
    }

    const accessToken = await getAccessToken(config);
    if (config.appUserId) {
        await prisma.userGmailAccount.update({
            where: { userId: config.appUserId },
            data: { lastUsedAt: new Date(), lastError: null },
        }).catch(() => undefined);
    }
    const requestedLimit = Number.isFinite(maxResults) && maxResults && maxResults > 0
        ? Math.floor(maxResults)
        : undefined;
    const parsed: ParsedGmailMessage[] = [];
    let nextPageToken: string | undefined;

    do {
        const remaining = requestedLimit ? requestedLimit - parsed.length : undefined;
        if (remaining !== undefined && remaining <= 0) break;

        const searchParams = new URLSearchParams({
            q: query,
            maxResults: String(Math.min(remaining ?? 100, 100)),
        });
        if (nextPageToken) {
            searchParams.set("pageToken", nextPageToken);
        }

        const list = await gmailFetch<GmailListResponse>(
            `/users/${encodeURIComponent(config.userId)}/messages?${searchParams.toString()}`,
            accessToken,
        );
        const messages = list.messages ?? [];

        for (const message of messages) {
            if (requestedLimit !== undefined && parsed.length >= requestedLimit) break;

            const full = await gmailFetch<GmailMessage>(
                `/users/${encodeURIComponent(config.userId)}/messages/${encodeURIComponent(message.id)}?format=full`,
                accessToken,
            );
            parsed.push(parseGmailMessage(full));
        }

        nextPageToken = list.nextPageToken;
    } while (nextPageToken);

    return parsed;
}
