import "dotenv/config";

const GMAIL_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
];

function requireEnv(name: string): string {
    const value = process.env[name];

    if (!value) {
        throw new Error(`${name} is required`);
    }

    return value;
}

function redirectUri(): string {
    return process.env.GMAIL_REDIRECT_URI ?? "http://localhost:4000/oauth/google/callback";
}

function printAuthUrl() {
    const clientId = requireEnv("GMAIL_CLIENT_ID");
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");

    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri());
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", GMAIL_SCOPES.join(" "));
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");

    console.log(url.toString());
}

async function exchangeCode() {
    const clientId = requireEnv("GMAIL_CLIENT_ID");
    const clientSecret = requireEnv("GMAIL_CLIENT_SECRET");
    const code = requireEnv("GMAIL_AUTH_CODE");
    const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            redirect_uri: redirectUri(),
            grant_type: "authorization_code",
        }),
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`OAuth code exchange failed: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as {
        refresh_token?: string;
        access_token?: string;
        expires_in?: number;
        scope?: string;
    };

    if (!data.refresh_token) {
        console.log(JSON.stringify(data, null, 2));
        throw new Error("No refresh_token returned. Re-run auth-url with prompt=consent and approve offline access.");
    }

    console.log(`GMAIL_REFRESH_TOKEN=${data.refresh_token}`);
}

async function main() {
    const command = process.argv[2];

    if (command === "auth-url") {
        printAuthUrl();
        return;
    }

    if (command === "exchange-code") {
        await exchangeCode();
        return;
    }

    throw new Error("Usage: pnpm gmail:auth-url | GMAIL_AUTH_CODE=... pnpm gmail:exchange-code");
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
