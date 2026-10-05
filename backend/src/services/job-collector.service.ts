import { JobProvider } from "../providers/job-provider";
import { Job } from "@prisma/client";
import { prisma } from "../infrastructure/prisma";
import { MockProvider } from "../providers/mock.provider";
import { LinkedInProvider } from "../providers/linkedin.provider";
import { createJobIfNew } from "./job-deduplication.service";
import { DrushimProvider } from "../providers/drushim.provider";
import { SqlinkProvider } from "../providers/sqlink.provider";
import { GotFriendsProvider } from "../providers/gotfriends.provider";
import { GreenhouseProvider } from "../providers/greenhouse.provider";
import { GlassdoorProvider } from "../providers/glassdoor.provider";
import { AllJobsProvider } from "../providers/alljobs.provider";
import { CenterIsraelCompaniesProvider } from "../providers/center-israel.provider";
import { LeverProvider } from "../providers/lever.provider";
import { AshbyProvider } from "../providers/ashby.provider";
import { ComeetProvider } from "../providers/comeet.provider";
import { WorkableProvider } from "../providers/workable.provider";
import { publicJobBoardProviders } from "../providers/public-job-board.provider";
import { filterRelevantJobs, setSearchLocationOverride } from "../providers/browser-provider-utils";
import { withJobQuality } from "../providers/job-quality";
import { SourceAuditTracker } from "../providers/source-audit";
import { hasAppliedVacancyForJob } from "./applied-vacancy.service";
import { updateAutomationProgress } from "./job-automation-progress.service";
import { recordProviderCompanyHits } from "./company-priority.service";
import {
    filterJobsBySearchPreferences,
    normalizeSearchPreferences,
    SearchPreferenceFilterStats,
    SearchPreferences,
} from "./search-preferences.service";
import { upsertUserJobMatch } from "./user-workspace.service";

function createProviderMap(options: {
    linkedInStorageStatePath?: string | null;
    preferences?: SearchPreferences;
    userId?: string;
} = {}): Record<string, JobProvider> {
    return {
        ...publicJobBoardProviders(),
        LINKEDIN: new LinkedInProvider({
            storageStatePath: options.linkedInStorageStatePath,
            preferences: options.preferences,
            userId: options.userId,
        }),
        GREENHOUSE: new GreenhouseProvider(),
        LEVER: new LeverProvider(),
        ASHBY: new AshbyProvider(),
        COMEET: new ComeetProvider(),
        WORKABLE: new WorkableProvider(),
        GLASSDOOR: new GlassdoorProvider(),
        DRUSHIM: new DrushimProvider(),
        SQLINK: new SqlinkProvider(),
        GOTFRIENDS: new GotFriendsProvider(),
        ALLJOBS: new AllJobsProvider(),
        CENTER_ISRAEL: new CenterIsraelCompaniesProvider({ userId: options.userId }),
        MOCK: new MockProvider(),
    };
}

function activeProviders(providerNames?: string[], options: {
    linkedInStorageStatePath?: string | null;
    preferences?: SearchPreferences;
    userId?: string;
} = {}): JobProvider[] {
    const providerMap = createProviderMap(options);
    const configured = providerNames?.length
        ? providerNames.join(",")
        : (process.env.ACTIVE_PROVIDERS ?? "LINKEDIN,CENTER_ISRAEL");
    const names = configured
        .split(",")
        .map((name) => name.trim().toUpperCase())
        .filter(Boolean);

    return names
        .filter((name) => name !== "LINKEDIN" || options.linkedInStorageStatePath !== null)
        .filter((name) => name !== "MOCK" || process.env.ENABLE_MOCK_PROVIDER === "true")
        .map((name) => providerMap[name])
        .filter((provider): provider is JobProvider => Boolean(provider));
}

function getProviderTimeoutMs(provider: JobProvider): number {
    const baseValue = Number(process.env.PROVIDER_TIMEOUT_MS ?? 150000);
    const linkedInValue = Number(process.env.LINKEDIN_PROVIDER_TIMEOUT_MS ?? 900000);
    const centerIsraelValue = Number(process.env.CENTER_ISRAEL_PROVIDER_TIMEOUT_MS ?? 1800000);
    const value = provider.source === "CENTER_ISRAEL"
        ? centerIsraelValue
        : provider.source === "LINKEDIN"
            ? linkedInValue
            : baseValue;

    return Number.isFinite(value) && value > 0 ? value : 150000;
}

async function searchWithTimeout(provider: JobProvider) {
    const timeoutMs = getProviderTimeoutMs(provider);

    return Promise.race([
        provider.search(),
        new Promise<never>((_, reject) => {
            setTimeout(
                () => reject(new Error(`Provider ${provider.source} timed out after ${timeoutMs}ms`)),
                timeoutMs,
            );
        }),
    ]);
}

type CollectJobsOptions = {
    searchLocation?: string;
    providerNames?: string[];
    preferences?: SearchPreferences;
    userId?: string;
    allowGlobalLinkedInFallback?: boolean;
};

export async function collectJobs(options: CollectJobsOptions = {}): Promise<Job[] & { preferenceFilterStats?: SearchPreferenceFilterStats }> {
     setSearchLocationOverride(options.searchLocation);

     try {
         const linkedInAccount = options.userId
             ? await prisma.userLinkedInAccount.findUnique({
                 where: { userId: options.userId },
             })
             : null;
         const preferences = normalizeSearchPreferences(options.preferences);
         const preferenceFilterStats: SearchPreferenceFilterStats = {
             input: 0,
             output: 0,
             excludedKeyword: 0,
             titleStopword: 0,
             excludedCompany: 0,
             remote: 0,
             targetRole: 0,
             targetLocation: 0,
             requiredTech: 0,
             dateRange: 0,
         };
         const linkedInStorageStatePath = options.userId
             ? linkedInAccount?.isActive
                 ? linkedInAccount.storageStatePath
                 : options.allowGlobalLinkedInFallback
                     ? undefined
                     : null
             : undefined;

         if (options.userId && !linkedInAccount?.isActive && !options.allowGlobalLinkedInFallback) {
             console.warn("[Job Collector] LinkedIn is not connected for this user; LINKEDIN provider will be skipped.");
         }

         // Log active providers
         const providers = activeProviders(options.providerNames, {
             linkedInStorageStatePath,
             preferences,
             userId: options.userId,
         });
         console.log(`\n[Job Collector] Active Providers (${providers.length}):`);
         for (const provider of providers) {
             console.log(`  ├─ ${provider.source}`);
         }
         console.log(`\n[Job Collector] Starting job collection from ${providers.length} providers...`);

         const allJobs = [];
         const sourceAudits = new Map<string, SourceAuditTracker>();
         const providerResults: Record<string, {success: number; failed: number; error?: string}> = {};

         for (const provider of providers) {
             try {
                 console.log(`  ├─ Fetching from ${provider.source}...`);
                 updateAutomationProgress(options.userId ?? "", {
                     stage: "Collecting",
                     message: `Fetching jobs from ${provider.source}...`,
                     currentTarget: provider.source,
                     providerStatus: {
                         source: provider.source,
                         phase: "Fetching jobs",
                     },
                 });
                 const jobs = (await searchWithTimeout(provider)).map(withJobQuality);
                 if (provider.source === "LINKEDIN" && options.userId && linkedInAccount?.isActive) {
                     await prisma.userLinkedInAccount.update({
                         where: { userId: options.userId },
                         data: { lastUsedAt: new Date() },
                     });
                 }
                 const audit = new SourceAuditTracker(provider.source);
                 sourceAudits.set(provider.source, audit);
                 if (provider.auditReport) Object.assign(audit.report, provider.auditReport);
                 else audit.increment("discoveredUrls", jobs.length);
                 const explicitlyRejected = jobs.filter((job) => job.ingestion?.qualityState === "REJECTED");
                 for (const job of explicitlyRejected.slice(0, 8)) {
                     audit.reject({
                         url: job.url,
                         title: job.title,
                         classification: job.ingestion?.classification,
                         reason: job.ingestion?.classificationReasons?.[0] ?? "QUALITY_REJECTED",
                     });
                 }
                 const relevant = filterRelevantJobs(jobs.filter((job) => job.ingestion?.qualityState !== "REJECTED"));
                 if (!provider.auditReport) {
                     audit.increment("classifiedJobPages", relevant.length);
                     audit.increment("normalizedJobs", relevant.length);
                 }
                 audit.increment("relevanceRejected", jobs.length - relevant.length);
                 audit.increment("categoryPagesRejected", explicitlyRejected.filter((job) => job.ingestion?.classification === "category").length);
                 audit.increment("structuredDataHits", relevant.filter((job) => job.ingestion?.extractionMethod === "json_ld" || job.ingestion?.extractionMethod === "embedded_json" || job.ingestion?.extractionMethod === "official_api").length);
                 audit.increment("domExtractionHits", relevant.filter((job) => job.ingestion?.extractionMethod === "source_dom" || job.ingestion?.extractionMethod === "heuristic_dom").length);
                 const { jobs: filtered, stats, decisions } = filterJobsBySearchPreferences(relevant, preferences);
                 audit.increment("locationRejected", stats.targetLocation + stats.remote);
                 if (process.env.JOB_FILTER_DEBUG === "true") {
                     for (const decision of decisions) {
                         console.log(`[Filter Debug] ${JSON.stringify({
                             source: provider.source,
                             title: decision.job.title,
                             company: decision.job.company ?? null,
                             checks: decision.checks,
                             final: decision.final,
                         })}`);
                     }
                 }
                 preferenceFilterStats.input += stats.input;
                 preferenceFilterStats.output += stats.output;
                 preferenceFilterStats.excludedKeyword += stats.excludedKeyword;
                 preferenceFilterStats.titleStopword += stats.titleStopword;
                 preferenceFilterStats.excludedCompany += stats.excludedCompany;
                 preferenceFilterStats.remote += stats.remote;
                 preferenceFilterStats.targetRole += stats.targetRole;
                 preferenceFilterStats.targetLocation += stats.targetLocation;
                 preferenceFilterStats.requiredTech += stats.requiredTech;
                 preferenceFilterStats.dateRange += stats.dateRange;
                 console.log(`  │  Found: ${jobs.length} jobs, Relevant: ${relevant.length}, Preferences: ${filtered.length}`);
                 updateAutomationProgress(options.userId ?? "", {
                     stage: "Collecting",
                     message: `${provider.source}: found ${jobs.length}, relevant ${relevant.length}, after preferences ${filtered.length}.`,
                     currentTarget: provider.source,
                     providerStatus: {
                         source: provider.source,
                         phase: "Filtered results",
                         totalCards: jobs.length,
                         prefilteredCards: filtered.length,
                     },
                 });
                 allJobs.push(...filtered);
                 providerResults[provider.source] = {success: filtered.length, failed: 0};
                 if (stats.excludedKeyword || stats.titleStopword || stats.excludedCompany || stats.remote || stats.targetRole || stats.targetLocation || stats.requiredTech || stats.dateRange) {
                     console.log(
                         `  │  Preference skips: excluded=${stats.excludedKeyword}, titleStopword=${stats.titleStopword}, blacklistCompany=${stats.excludedCompany}, remote=${stats.remote}, role=${stats.targetRole}, location=${stats.targetLocation}, tech=${stats.requiredTech}, date=${stats.dateRange}`,
                     );
                 }
             } catch (error) {
                 const errorMsg = (error as any).message;
                 console.error(`  ├─ ✗ ${provider.source} failed: ${errorMsg}`);
                 updateAutomationProgress(options.userId ?? "", {
                     stage: "Collecting",
                     message: `${provider.source} failed: ${errorMsg}`,
                     currentTarget: provider.source,
                     providerStatus: {
                         source: provider.source,
                         phase: "Failed",
                     },
                 });
                 providerResults[provider.source] = {success: 0, failed: 1, error: errorMsg};
             }
         }

         console.log(`\n[Job Collector] Collected ${allJobs.length} jobs total from all providers`);
         await recordProviderCompanyHits(allJobs);
         console.log(`[Job Collector] Starting deduplication...`);

         const saved = [];
         let duplicates = 0;
         let retryable = 0;
         let alreadyApplied = 0;

         for (const job of allJobs) {
             if (options.userId && await hasAppliedVacancyForJob(options.userId, job)) {
                 alreadyApplied++;
                 continue;
             }

             const result = await createJobIfNew(job);
             const audit = sourceAudits.get(job.source);
             if (options.userId) {
                 const existingMatch = await prisma.userJobMatch.findUnique({
                     where: {
                         userId_jobId: {
                             userId: options.userId,
                             jobId: result.job.id,
                         },
                     },
                 });
                 const shouldQueueForUser =
                     !existingMatch ||
                     (
                         existingMatch.status !== "IGNORED" &&
                         existingMatch.status !== "APPLIED" &&
                         existingMatch.matchScore == null
                     );

                 if (!existingMatch) {
                     await upsertUserJobMatch(options.userId, result.job.id, {
                         status: "NEW",
                     });
                 }

                 if (shouldQueueForUser) {
                     saved.push(result.job);
                     if (result.isNew) audit?.increment("savedJobs");
                     else audit?.increment("duplicates");
                 } else {
                     duplicates++;
                     audit?.increment("duplicates");
                 }
                 continue;
             }

             if (result.isNew) {
                 saved.push(result.job);
                 audit?.increment("savedJobs");
             } else if (result.shouldProcess) {
                 retryable++;
                 saved.push(result.job);
                 audit?.increment("duplicates");
             } else {
                 duplicates++;
                 audit?.increment("duplicates");
             }
         }

         console.log(`[Job Collector] Deduplication complete:`);
         console.log(`  ├─ Jobs queued for processing: ${saved.length}`);
         console.log(`  ├─ Retryable existing jobs: ${retryable}`);
         console.log(`  ├─ Duplicates (skipped): ${duplicates}`);
         console.log(`  └─ Already applied (skipped): ${alreadyApplied}`);
         for (const audit of sourceAudits.values()) audit.log("PERSISTENCE_COMPLETE");

         return Object.assign(saved, {
             preferenceFilterStats,
         });
     } finally {
         setSearchLocationOverride(undefined);
     }
}
