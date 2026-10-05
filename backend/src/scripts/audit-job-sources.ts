import { prisma } from "../infrastructure/prisma";
import { GreenhouseProvider } from "../providers/greenhouse.provider";
import { LeverProvider } from "../providers/lever.provider";
import { AshbyProvider } from "../providers/ashby.provider";
import { ComeetProvider } from "../providers/comeet.provider";
import { WorkableProvider } from "../providers/workable.provider";
import { DrushimProvider } from "../providers/drushim.provider";
import { GotFriendsProvider } from "../providers/gotfriends.provider";
import { SqlinkProvider } from "../providers/sqlink.provider";
import { AllJobsProvider } from "../providers/alljobs.provider";
import { publicJobBoardProviders } from "../providers/public-job-board.provider";
import type { JobProvider } from "../providers/job-provider";
import { withJobQuality } from "../providers/job-quality";

const publicBoards = publicJobBoardProviders();
const providers: Record<string, JobProvider> = {
    GREENHOUSE: new GreenhouseProvider(),
    LEVER: new LeverProvider(),
    ASHBY: new AshbyProvider(),
    COMEET: new ComeetProvider(),
    WORKABLE: new WorkableProvider(),
    DEVJOBS: publicBoards.DEVJOBS,
    ALLJOBS: new AllJobsProvider(),
    DRUSHIM: new DrushimProvider(),
    JOBMASTER: publicBoards.JOBMASTER,
    GOTFRIENDS: new GotFriendsProvider(),
    SQLINK: new SqlinkProvider(),
    ETHOSIA: publicBoards.ETHOSIA,
    NISHA: publicBoards.NISHA,
    JOBIFY: publicBoards.JOBIFY,
    EMPLOYBL: publicBoards.EMPLOYBL,
};

function requestedSources(): string[] {
    const values = process.argv.slice(2).flatMap((value) => value.split(","));
    return (values.length ? values : Object.keys(providers))
        .map((value) => value.trim().toUpperCase())
        .filter((value) => Boolean(providers[value]));
}

async function main() {
    for (const source of requestedSources()) {
        const provider = providers[source];
        const startedAt = Date.now();
        try {
            const jobs = (await provider.search()).map(withJobQuality);
            const invalid = jobs.filter((job) => {
                const classification = job.ingestion?.classification;
                return Boolean(classification && classification !== "job_detail" && classification !== "unknown");
            });
            const sourceAsCompany = jobs.filter((job) => job.company?.trim().toUpperCase() === source);
            const explicitlyForeignButEligible = jobs.filter((job) =>
                /poland|romania|germany|france|spain|italy|united kingdom|united states|canada|india/i.test(job.location ?? "")
                && job.ingestion?.locationEligibility === "ELIGIBLE",
            );
            console.log(`[Live Source Audit] ${JSON.stringify({
                source,
                elapsedMs: Date.now() - startedAt,
                returned: jobs.length,
                classifications: jobs.reduce<Record<string, number>>((acc, job) => {
                    const key = job.ingestion?.classification ?? "unknown";
                    acc[key] = (acc[key] ?? 0) + 1;
                    return acc;
                }, {}),
                qualityStates: jobs.reduce<Record<string, number>>((acc, job) => {
                    const key = job.ingestion?.qualityState ?? "UNKNOWN";
                    acc[key] = (acc[key] ?? 0) + 1;
                    return acc;
                }, {}),
                missing: {
                    company: jobs.filter((job) => !job.company).length,
                    location: jobs.filter((job) => !job.location).length,
                    postedAt: jobs.filter((job) => !job.postedAt).length,
                    description: jobs.filter((job) => job.description.trim().length < 80).length,
                },
                contradictions: {
                    nonDetailReturned: invalid.length,
                    sourceUsedAsCompany: sourceAsCompany.length,
                    explicitForeignMarkedEligible: explicitlyForeignButEligible.length,
                },
                providerAudit: provider.auditReport,
                examples: jobs.slice(0, 3).map((job) => ({
                    title: job.title,
                    company: job.company ?? null,
                    location: job.location ?? null,
                    postedAt: job.postedAt?.toISOString() ?? null,
                    url: job.url ?? null,
                    extractionMethod: job.ingestion?.extractionMethod ?? null,
                    qualityState: job.ingestion?.qualityState ?? null,
                    locationEligibility: job.ingestion?.locationEligibility ?? null,
                })),
            })}`);
        } catch (error) {
            console.error(`[Live Source Audit] ${JSON.stringify({
                source,
                elapsedMs: Date.now() - startedAt,
                error: error instanceof Error ? error.message.split("\n")[0] : String(error),
            })}`);
        }
    }
}

main()
    .finally(() => prisma.$disconnect())
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
