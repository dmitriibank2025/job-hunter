import { prisma } from "../infrastructure/prisma";
import { normalizeCompanyName } from "./search-preferences.service";

export type AtsKind = "greenhouse" | "lever" | "ashby" | "comeet" | "workable" | "custom";

export type AtsDiscoveryResult = {
    ats: AtsKind;
    accountSlug: string | null;
    confidence: number;
    detectedUrl?: string;
};

export type DiscoveredAtsBoard = {
    company: string;
    key: string;
    region?: "global" | "eu";
};

type AtsPattern = {
    ats: Exclude<AtsKind, "custom">;
    pattern: RegExp;
};

const ATS_PATTERNS: AtsPattern[] = [
    { ats: "greenhouse", pattern: /(?:job-boards|boards)\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_-]+)/i },
    { ats: "lever", pattern: /jobs\.(?:eu\.)?lever\.co\/([a-z0-9_-]+)/i },
    { ats: "ashby", pattern: /jobs\.ashbyhq\.com\/([a-z0-9_-]+)/i },
    { ats: "comeet", pattern: /comeet\.com\/(?:jobs|careers)\/([a-z0-9_-]+)/i },
    { ats: "workable", pattern: /apply\.workable\.com\/([a-z0-9_-]+)/i },
];

export function detectAtsConfiguration(value: string): AtsDiscoveryResult {
    for (const candidate of ATS_PATTERNS) {
        const match = candidate.pattern.exec(value);
        if (match?.[1]) {
            return {
                ats: candidate.ats,
                accountSlug: match[1],
                confidence: 95,
                detectedUrl: match[0],
            };
        }
    }
    return { ats: "custom", accountSlug: null, confidence: 25 };
}

export async function recordAtsDiscovery(input: {
    careerUrl: string;
    companyName: string;
    result: AtsDiscoveryResult;
    finalUrl?: string;
}): Promise<void> {
    const { careerUrl, companyName, result } = input;
    await prisma.atsSourceConfiguration.upsert({
        where: { careerUrl },
        create: {
            companyName,
            normalizedCompany: normalizeCompanyName(companyName),
            careerUrl,
            atsType: result.ats,
            accountSlug: result.accountSlug,
            confidence: result.confidence,
            metadata: { finalUrl: input.finalUrl, detectedUrl: result.detectedUrl },
        },
        update: {
            companyName,
            normalizedCompany: normalizeCompanyName(companyName),
            atsType: result.ats,
            accountSlug: result.accountSlug,
            confidence: result.confidence,
            lastDiscoveredAt: new Date(),
            metadata: { finalUrl: input.finalUrl, detectedUrl: result.detectedUrl },
        },
    });
}

async function fetchCareerHtml(careerUrl: string): Promise<{ html: string; finalUrl: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
        const response = await fetch(careerUrl, {
            signal: controller.signal,
            redirect: "follow",
            headers: { "user-agent": "Mozilla/5.0 JobHunter ATS discovery" },
        });
        if (!response.ok) throw new Error(`ATS discovery returned ${response.status}`);
        return { html: await response.text(), finalUrl: response.url };
    } finally {
        clearTimeout(timer);
    }
}

export async function discoverATS(careerUrl: string, companyName?: string): Promise<AtsDiscoveryResult> {
    let result = detectAtsConfiguration(careerUrl);
    let finalUrl = careerUrl;

    if (result.ats === "custom") {
        try {
            const fetched = await fetchCareerHtml(careerUrl);
            finalUrl = fetched.finalUrl;
            const fromRedirect = detectAtsConfiguration(finalUrl);
            result = fromRedirect.ats !== "custom"
                ? { ...fromRedirect, confidence: 100, detectedUrl: finalUrl }
                : detectAtsConfiguration(fetched.html);
        } catch {
            // Keep a low-confidence custom result. Discovery failure must not block custom scraping.
        }
    }

    const resolvedCompany = companyName?.trim() || new URL(careerUrl).hostname.replace(/^www\./, "");
    await recordAtsDiscovery({ careerUrl, companyName: resolvedCompany, result, finalUrl });

    return result;
}

export async function listDiscoveredAtsConfigurations() {
    return prisma.atsSourceConfiguration.findMany({
        where: { active: true },
        orderBy: [{ confidence: "desc" }, { lastDiscoveredAt: "desc" }],
    });
}

export async function mergeDiscoveredAtsBoards(
    ats: Exclude<AtsKind, "custom" | "comeet">,
    configured: DiscoveredAtsBoard[],
): Promise<DiscoveredAtsBoard[]> {
    let discovered: Awaited<ReturnType<typeof listDiscoveredAtsConfigurations>> = [];
    try {
        discovered = await listDiscoveredAtsConfigurations();
    } catch (error) {
        // Deployments can briefly run new code before the migration is applied.
        console.warn(`[ATS Discovery] Stored configurations unavailable: ${error instanceof Error ? error.message : String(error)}`);
        return configured;
    }

    const result = new Map<string, DiscoveredAtsBoard>();
    for (const board of configured) result.set(board.key.toLowerCase(), board);
    for (const row of discovered) {
        if (row.atsType !== ats || !row.accountSlug || row.confidence < 80) continue;
        const key = row.accountSlug.trim();
        if (!key || result.has(key.toLowerCase())) continue;
        result.set(key.toLowerCase(), {
            company: row.companyName,
            key,
            region: /jobs\.eu\.lever\.co/i.test(row.careerUrl) ? "eu" : "global",
        });
    }
    return [...result.values()];
}
