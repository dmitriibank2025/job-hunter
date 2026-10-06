import { createHash } from "crypto";

export type NamedBoard = {
    company: string;
    key: string;
    region?: "global" | "eu";
};

export function parseNamedBoards(value?: string): NamedBoard[] {
    return (value ?? "")
        .split(/[\n,;]/)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
            const [companyValue, keyValue, regionValue] = entry.split("|").map((part) => part.trim());
            const key = keyValue || companyValue;
            return {
                company: keyValue ? companyValue : key,
                key,
                region: regionValue?.toLowerCase() === "eu" ? "eu" as const : "global" as const,
            };
        });
}

export function stripHtml(value?: string | null): string {
    return (value ?? "")
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;|&#160;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/\s+/g, " ")
        .trim();
}

export function safeDate(value?: string | number | null): Date | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    const date = typeof value === "number"
        ? new Date(value < 10_000_000_000 ? value * 1000 : value)
        : new Date(value);
    return Number.isFinite(date.getTime()) ? date : undefined;
}

export function stableExternalId(value: string): string {
    try {
        const url = new URL(value);
        for (const key of ["JobID", "jobId", "key", "gh_jid", "currentJobId"]) {
            const identifier = url.searchParams.get(key)?.trim();
            if (identifier) return identifier;
        }
        const last = url.pathname.split("/").filter(Boolean).at(-1);
        if (last && last.length >= 6 && !/\.[a-z0-9]{2,5}$/i.test(last)) return last;
    } catch {
        // Hash non-URL identifiers below.
    }
    return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

export async function fetchJson<T>(url: string, options: RequestInit = {}, timeoutMs = 20_000): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: { accept: "application/json", ...options.headers },
        });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return await response.json() as T;
    } finally {
        clearTimeout(timer);
    }
}
