import { JobProvider } from "./job-provider";
import { ParsedJob } from "./types";

export class MockProvider implements JobProvider {
    source = "MOCK";

    async search(): Promise<ParsedJob[]> {
        return [
            {
                title: "Backend Developer",
                company: "Mock Company",
                location: "Tel Aviv",
                url: "https://example.com/backend-job",
                postedAt: new Date("2026-06-02T00:00:00.000Z"),
                source: "MOCK",
                description:
                    "Backend Developer with Node.js, TypeScript, AWS Lambda, SQS, PostgreSQL, Redis and REST API experience.",
            },
        ];
    }
}
