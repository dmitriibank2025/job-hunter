import { JobProvider } from "./job-provider";
import { ParsedJob } from "./types";
import { fetchJson, safeDate, stripHtml } from "./ats-provider-utils";

type ComeetAccount = { company: string; uid: string; token: string };
type ComeetPosition = {
    uid: string;
    name: string;
    company_name?: string;
    location?: { name?: string };
    url_comeet_hosted_page?: string;
    url_active_page?: string;
    time_updated?: string;
    details?: Array<{ name?: string; value?: string }>;
};

export function parseComeetAccounts(value?: string): ComeetAccount[] {
    return (value ?? "").split(/[\n;]/).map((entry) => entry.trim()).filter(Boolean).flatMap((entry) => {
        const [company, uid, token] = entry.split("|").map((part) => part.trim());
        return company && uid && token ? [{ company, uid, token }] : [];
    });
}

export class ComeetProvider implements JobProvider {
    source = "COMEET";

    async search(): Promise<ParsedJob[]> {
        const accounts = parseComeetAccounts(process.env.COMEET_ACCOUNTS);
        if (!accounts.length) {
            console.warn("[Comeet] No COMEET_ACCOUNTS configured — skipping.");
            return [];
        }
        const jobs: ParsedJob[] = [];
        for (const account of accounts) {
            const url = `https://www.comeet.co/careers-api/2.0/company/${encodeURIComponent(account.uid)}/positions?token=${encodeURIComponent(account.token)}&details=true`;
            try {
                const positions = await fetchJson<ComeetPosition[]>(url, {}, 60_000);
                for (const position of positions) {
                    const jobUrl = position.url_active_page ?? position.url_comeet_hosted_page;
                    if (!jobUrl) continue;
                    jobs.push({
                        title: position.name,
                        company: position.company_name ?? account.company,
                        location: position.location?.name,
                        url: jobUrl,
                        externalJobId: position.uid,
                        postedAt: safeDate(position.time_updated),
                        source: "COMEET",
                        description: (position.details ?? []).map((item) => `${item.name ?? ""}\n${stripHtml(item.value)}`).join("\n").trim() || position.name,
                        applyUrl: position.url_active_page ?? position.url_comeet_hosted_page,
                        ingestion: {
                            classification: "job_detail",
                            classificationReasons: ["OFFICIAL_COMEET_API"],
                            extractionMethod: "official_api",
                            canonicalUrl: jobUrl,
                            fieldConfidence: {
                                title: 100,
                                company: position.company_name || account.company ? 100 : 0,
                                location: position.location?.name ? 95 : 0,
                                postedAt: position.time_updated ? 70 : 0,
                                description: position.details?.length ? 100 : 20,
                                applyUrl: jobUrl ? 90 : 0,
                            },
                            sourceDetail: { dateSemantics: "comeet_time_updated" },
                        },
                    });
                }
                console.log(`[Comeet] ${account.company}: ${positions.length} published jobs`);
            } catch (error) {
                console.error(`[Comeet] ${account.company} failed:`, error instanceof Error ? error.message : error);
            }
        }
        return jobs;
    }
}
