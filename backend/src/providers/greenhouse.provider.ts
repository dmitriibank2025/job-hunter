import { JobProvider } from "./job-provider";
import { ParsedJob } from "./types";

// ─── CONFIG ───────────────────────────────────────────────────────────────────

// Таймаут одного запроса к Greenhouse API (мс)
const FETCH_TIMEOUT_MS = 15_000;

// Задержка между board-запросами — снижает риск rate-limit
const BOARD_THROTTLE_MS = 300;

// ─── TYPES ────────────────────────────────────────────────────────────────────

type GreenhouseJob = {
    id: number;
    title: string;
    absolute_url?: string;
    updated_at?: string;
    location?: { name?: string };
    content?: string;
};

type GreenhouseBoardResponse = {
    jobs?: GreenhouseJob[];
    error?: string;
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function stripHtml(value?: string): string {
    return (value ?? "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/\s+/g, " ")
        .trim();
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function boardTokens(): string[] {
    return (process.env.GREENHOUSE_BOARD_TOKENS ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
}

async function fetchBoardJobs(boardToken: string): Promise<GreenhouseJob[]> {
    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs?content=true`;

    // AbortController даёт таймаут на уровне fetch — без него висит бесконечно
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;

    try {
        response = await fetch(url, { signal: controller.signal });
    } catch (error: unknown) {
        const isAbort =
            error instanceof Error && error.name === "AbortError";
        throw new Error(
            isAbort
                ? `Greenhouse timeout for board "${boardToken}" after ${FETCH_TIMEOUT_MS}ms`
                : `Greenhouse fetch error for board "${boardToken}": ${String(error)}`,
        );
    } finally {
        clearTimeout(timer);
    }

    if (!response.ok) {
        throw new Error(
            `Greenhouse API returned ${response.status} for board "${boardToken}"`,
        );
    }

    const data = (await response.json()) as GreenhouseBoardResponse;

    // Greenhouse иногда возвращает 200 с { error: "..." }
    if (data.error) {
        throw new Error(`Greenhouse API error for board "${boardToken}": ${data.error}`);
    }

    return data.jobs ?? [];
}

// ─── PROVIDER ─────────────────────────────────────────────────────────────────

export class GreenhouseProvider implements JobProvider {
    source = "GREENHOUSE";

    async search(): Promise<ParsedJob[]> {
        const tokens = boardTokens();

        if (tokens.length === 0) {
            console.warn("[Greenhouse] No board tokens configured — skipping.");
            return [];
        }

        const jobs: ParsedJob[] = [];

        for (let index = 0; index < tokens.length; index++) {
            const boardToken = tokens[index];

            try {
                const boardJobs = await fetchBoardJobs(boardToken);

                console.log(
                    `[Greenhouse] Board "${boardToken}": ${boardJobs.length} jobs`,
                );

                for (const job of boardJobs) {
                    const description = stripHtml(job.content);

                    jobs.push({
                        title: job.title,
                        // Используем реальное название компании из API если есть,
                        // иначе boardToken как идентификатор источника
                        company: boardToken,
                        location: job.location?.name,
                        url: job.absolute_url,
                        externalJobId: String(job.id),
                        postedAt: job.updated_at ? new Date(job.updated_at) : undefined,
                        source: "GREENHOUSE",
                        // Если описание пустое — не теряем вакансию, fallback на title
                        description: description || job.title,
                    });
                }

            } catch (error) {
                // Один упавший board не останавливает остальные
                console.error(
                    `[Greenhouse] Failed board "${boardToken}":`,
                    error instanceof Error ? error.message : error,
                );
            }

            // Throttle между board-запросами
            if (index < tokens.length - 1) {
                await sleep(BOARD_THROTTLE_MS);
            }
        }

        console.log(`[Greenhouse] Total collected: ${jobs.length} jobs`);
        return jobs;
    }
}
