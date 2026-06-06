type GmailConfig = {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    userId: string;
};

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

function getGmailConfig(): GmailConfig | null {
    const clientId = process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET;
    const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
    const userId = process.env.GMAIL_USER_ID ?? "me";

    if (!clientId || !clientSecret || !refreshToken) {
        return null;
    }

    return {
        clientId,
        clientSecret,
        refreshToken,
        userId,
    };
}

export function isGmailConfigured(): boolean {
    return getGmailConfig() !== null;
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

export async function searchGmailMessages(query: string, maxResults = 25): Promise<ParsedGmailMessage[]> {
    const config = getGmailConfig();

    if (!config) {
        return [];
    }

    const accessToken = await getAccessToken(config);
    const searchParams = new URLSearchParams({
        q: query,
        maxResults: String(Math.min(Math.max(maxResults, 1), 100)),
    });
    const list = await gmailFetch<GmailListResponse>(
        `/users/${encodeURIComponent(config.userId)}/messages?${searchParams.toString()}`,
        accessToken,
    );
    const messages = list.messages ?? [];

    const parsed: ParsedGmailMessage[] = [];

    for (const message of messages) {
        const full = await gmailFetch<GmailMessage>(
            `/users/${encodeURIComponent(config.userId)}/messages/${encodeURIComponent(message.id)}?format=full`,
            accessToken,
        );
        parsed.push(parseGmailMessage(full));
    }

    return parsed;
}
