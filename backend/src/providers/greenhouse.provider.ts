import { JobProvider } from "./job-provider";
import { ParsedJob } from "./types";

type GreenhouseJob = {
    id: number;
    title: string;
    absolute_url?: string;
    updated_at?: string;
    location?: {
        name?: string;
    };
    content?: string;
};

type GreenhouseBoardResponse = {
    jobs?: GreenhouseJob[];
};

function stripHtml(value?: string): string {
    return (value ?? "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

export class GreenhouseProvider implements JobProvider {
    source = "GREENHOUSE";

    async search(): Promise<ParsedJob[]> {
        const boardTokens = (process.env.GREENHOUSE_BOARD_TOKENS ?? "")
            .split(",")
            .map((token) => token.trim())
            .filter(Boolean);

        if (boardTokens.length === 0) {
            return [];
        }

        const jobs: ParsedJob[] = [];

        for (const boardToken of boardTokens) {
            const response = await fetch(
                `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs?content=true`,
            );

            if (!response.ok) {
                console.error(`Greenhouse provider failed for ${boardToken}: ${response.status}`);
                continue;
            }

            const data = (await response.json()) as GreenhouseBoardResponse;

            for (const job of data.jobs ?? []) {
                jobs.push({
                    title: job.title,
                    company: boardToken,
                    location: job.location?.name,
                    url: job.absolute_url,
                    postedAt: job.updated_at ? new Date(job.updated_at) : undefined,
                    source: "GREENHOUSE",
                    description: stripHtml(job.content) || job.title,
                });
            }
        }

        return jobs;
    }
}
