import { Job } from "@prisma/client";
import path from "path";
import { collectJobs } from "./job-collector.service";
import { collectJobsFromEmailLinks } from "./email-link-job-collector.service";
import { generateCoverLetterForJob, generateResumeForJob } from "./resume-generator.service";
import { runEmailReport } from "./email-report.service";
import { listAppliedVacancies } from "./applied-vacancy.service";
import { sendTelegramMessageToUser } from "./telegram.service";
import { analyzeJob } from "./job-analyzer.service";
import { selectResumeBaseForJob } from "./resume-base-selector.service";
import type { ResumeBaseSelectionMap } from "./resume-base-selector.service";
import {
    filterJobsBySearchPreferences,
    normalizeSearchPreferences,
    SearchPreferenceFilterStats,
    SearchPreferences,
} from "./search-preferences.service";
import { applyUserSearchFiltersToPreferences } from "./company-blacklist.service";
import {
    failAutomationProgress,
    finishAutomationProgress,
    startAutomationProgress,
    updateAutomationProgress,
} from "./job-automation-progress.service";
import {
    assertUserLimit,
    getVacancyCollectionAllowance,
    recordUsageEvent,
    upsertUserJobMatch,
} from "./user-workspace.service";

type GeneratedResume = Awaited<ReturnType<typeof generateResumeForJob>>;
type GeneratedCoverLetter = Awaited<ReturnType<typeof generateCoverLetterForJob>>;
type AnalyzedJob = Job & {
    matchScore: number;
    analysis: any;
};

type FollowUpEntry = {
    title: string;
    company: string;
    status: string;
    source: string;
    jobUrl?: string | null;
    emailSubject?: string | null;
    emailFrom?: string | null;
    lastSeenAt: Date;
};

export type JobAutomationReport = {
    collectedAt: Date;
    searchLocation?: string;
    newJobs: Job[];
    analyzedJobs: AnalyzedJob[];
    generatedResumes: GeneratedResume[];
    generatedCoverLetters: GeneratedCoverLetter[];
    emailReport: Awaited<ReturnType<typeof runEmailReport>>;
    followUp: {
        needsReply: FollowUpEntry[];
        answered: FollowUpEntry[];
    };
    telegramSent: boolean;
    message: string;
    sourceMode: JobAutomationSourceMode;
    preferenceFilterStats?: SearchPreferenceFilterStats;
    userLimitStats?: {
        userId: string;
        collectedAllowed: number;
        collectedSkippedByPlan: number;
    };
};

export type JobAutomationSourceMode = "EMAIL" | "PROVIDERS" | "CENTER_ISRAEL";

const ANSWERED_STATUSES = new Set([
    "APPLICATION_RECEIVED",
    "APPLICATION_VIEWED",
    "REJECTION",
    "POSITIVE_RESPONSE",
]);

const NEEDS_REPLY_STATUSES = new Set([
    "ACTION_REQUIRED",
    "RECRUITER_MESSAGE",
]);
const ANSWERED_REPORT_WINDOW_MS = 24 * 60 * 60 * 1000;

// Конфигурация параллельной обработки
const ANALYSIS_CONCURRENCY = parseInt(process.env.ANALYSIS_CONCURRENCY || "5", 10);
const GENERATION_CONCURRENCY = parseInt(process.env.GENERATION_CONCURRENCY || "3", 10);

function formatDate(date: Date): string {
    return new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: process.env.JOB_REPORT_TIMEZONE ?? "Asia/Jerusalem",
    }).format(date);
}

function formatFollowUpEntry(entry: FollowUpEntry): string {
    const details = [entry.status.replaceAll("_", " "), entry.source]
        .filter(Boolean)
        .join(" | ");
    const url = entry.jobUrl ? `\n${entry.jobUrl}` : "";
    const subject = entry.emailSubject ? `\n${entry.emailSubject}` : "";
    const from = entry.emailFrom ? `\n${entry.emailFrom}` : "";

    return `${entry.company} — ${entry.title}\n${details}\n${formatDate(entry.lastSeenAt)}${from}${subject}${url}`;
}

function buildFollowUpSection(entries: FollowUpEntry[], title: string): string {
    if (entries.length === 0) {
        return `${title}\nNone.`;
    }

    return [
        title,
        entries.map((entry, index) => `${index + 1}. ${formatFollowUpEntry(entry)}`).join("\n\n"),
    ].join("\n");
}

function buildAutomationMessage(
    collectedAt: Date,
    newJobs: Job[],
    analyzedJobs: AnalyzedJob[],
    generatedResumes: GeneratedResume[],
    generatedCoverLetters: GeneratedCoverLetter[],
    skippedJobs: Array<{job: Job; reason: string}>,
    failedResumes: Array<{job: Job; error: string}>,
    failedAnalysis: string[],
    emailReportMessage: string | null,
    followUp: JobAutomationReport["followUp"],
): string {
    const sections: string[] = [
        "📋 JOB HUNTER AUTOMATION REPORT",
        `⏰ Time: ${formatDate(collectedAt)}`,
        "",
        "════════════════════════════════════",
    ];

    sections.push(
        `📊 SUMMARY`,
        `├─ Jobs Found: ${newJobs.length}`,
        `├─ Resumes Generated: ${generatedResumes.length}`,
        `├─ Cover Letters Generated: ${generatedCoverLetters.length}`,
        `├─ Skipped (Low Score/Not Match): ${skippedJobs.length}`,
        `├─ Failed Resumes: ${failedResumes.length}`,
        `├─ Failed Analysis: ${failedAnalysis.length}`,
        "",
    );

    if (generatedResumes.length > 0) {
        sections.push(
            `✅ RESUMES GENERATED (${generatedResumes.length})`,
            "",
        );

        for (let i = 0; i < generatedResumes.length; i++) {
            const resume = generatedResumes[i];
            const job = analyzedJobs.find(j => j.id === resume.jobId) ??
                newJobs.find(j => j.id === resume.jobId);

            if (job) {
                const analyzedJob = analyzedJobs.find(j => j.id === job.id);
                const score = analyzedJob?.matchScore == null ? "Not analyzed" : `${analyzedJob.matchScore}/100`;
                sections.push(
                    `${i + 1}. ${job.title} @ ${job.company}`,
                    `   📍 Score: ${score}`,
                    `   🔗 Job: ${job.url || "No URL"}`,
                    `   📄 Resume: storage/resumes/*/*.md`,
                    `   💼 DOCX: storage/resumes/*/*.docx`,
                    ``,
                    `   HOW TO APPLY:`,
                    `   Option 1: Manual (Recommended)`,
                    `     • Open job URL: ${job.url}`,
                    `     • Copy resume from file: storage/resumes/*/*.md`,
                    `     • Paste into application form`,
                    ``,
                    `   Option 2: Direct Link`,
                    `     • Upload DOCX file: storage/resumes/*/*.docx`,
                    ``,
                );
            }
        }
        sections.push("");
    }

    if (failedResumes.length > 0) {
        sections.push(
            `❌ Failed resume details are available in backend logs. Count: ${failedResumes.length}`,
            "",
        );
    }

    sections.push(
        buildFollowUpSection(followUp.needsReply, "🔔 NEED REPLY (Active Applications)"),
        "",
        buildFollowUpSection(followUp.answered, "✅ ANSWERED (Application Status, last 24h)"),
        "",
    );

    if (emailReportMessage) {
        sections.push(
            "📧 EMAIL REPORT",
            emailReportMessage,
        );
    }

    return sections.join("\n");
}

function toFollowUpEntry(vacancy: {
    title: string;
    company: string;
    status: string;
    source: string;
    jobUrl?: string | null;
    emailSubject?: string | null;
    emailFrom?: string | null;
    lastSeenAt: Date;
}): FollowUpEntry {
    return {
        title: vacancy.title,
        company: vacancy.company,
        status: vacancy.status,
        source: vacancy.source,
        jobUrl: vacancy.jobUrl ?? null,
        emailSubject: vacancy.emailSubject ?? null,
        emailFrom: vacancy.emailFrom ?? null,
        lastSeenAt: vacancy.lastSeenAt,
    };
}

function dedupeJobs(jobs: Job[]): Job[] {
    const seen = new Set<string>();

    return jobs.filter((job) => {
        if (seen.has(job.id)) return false;
        seen.add(job.id);
        return true;
    });
}

const REQUIRED_MATCH_SCORE = Number(process.env.MIN_MATCH_SCORE ?? 60);
const SKIP_RECOMMENDATIONS = new Set(["SKIP"]);

function emptyEmailReport() {
    return {
        enabled: false,
        configured: false,
        syncedCount: 0,
        newEventsCount: 0,
        appliedHistoryFromEmails: 0,
        appliedHistoryFromLocalApplications: 0,
        events: [],
        message: "Email report skipped for this source mode.",
    } as Awaited<ReturnType<typeof runEmailReport>>;
}


// Параллельная обработка с ограничением конкурентности
async function processBatch<T, R>(
    items: T[],
    processor: (item: T, index: number) => Promise<R>,
    concurrency: number,
    onProgress?: (processed: number, total: number) => void
): Promise<{ results: R[]; errors: { item: T; error: string }[] }> {
    const results: R[] = [];
    const errors: { item: T; error: string }[] = [];

    for (let i = 0; i < items.length; i += concurrency) {
        const batch = items.slice(i, i + concurrency);
        const batchPromises = batch.map((item, idx) =>
            processor(item, i + idx).then(
                result => ({ success: true as const, result, item }),
                error => ({ success: false as const, error: error.message, item })
            )
        );

        const batchResults = await Promise.all(batchPromises);

        for (const res of batchResults) {
            if (res.success) {
                results.push(res.result);
            } else {
                errors.push({ item: res.item, error: res.error });
            }
        }

        if (onProgress) {
            onProgress(Math.min(i + concurrency, items.length), items.length);
        }
    }

    return { results, errors };
}

export async function runJobAutomationWorkflowWithSource(options: {
    searchLocation?: string;
    sourceMode?: JobAutomationSourceMode;
    preferences?: SearchPreferences;
    userId?: string;
    resumeBaseId?: string;
    resumeBaseIds?: ResumeBaseSelectionMap;
    allowGlobalLinkedInFallback?: boolean;
}): Promise<JobAutomationReport> {
    const { searchLocation, sourceMode = "PROVIDERS" } = options;
    const { userId, resumeBaseId } = options;
    if (!userId) {
        throw new Error("userId is required for job automation workflow");
    }
    // Fold the user's persisted company blacklist + exclude-remote toggle into the
    // request preferences so both daily and manual searches honor them.
    const mergedPreferences = await applyUserSearchFiltersToPreferences(userId, options.preferences);
    const preferences = normalizeSearchPreferences(mergedPreferences);
    const selectedResumeBaseIds = new Map<string, string>();
    const requiredMatchScore = preferences.minMatchScore ?? REQUIRED_MATCH_SCORE;
    const collectedAt = new Date();
    startAutomationProgress(userId, 5);

    try {
        await assertUserLimit(userId, "SEARCH_RUN");
        await recordUsageEvent(userId, "SEARCH_RUN", 1, { sourceMode, searchLocation });

        const emailReport = sourceMode === "EMAIL"
            ? (updateAutomationProgress(userId, {
                stage: "Email report",
                message: "Reading email report...",
                percent: 5,
                currentStep: 1,
            }), await runEmailReport(userId, preferences.gmailScanDays))
            : emptyEmailReport();

        const rawEmailLinkJobs = sourceMode === "EMAIL"
            ? (updateAutomationProgress(userId, {
                stage: "Email links",
                message: "Collecting jobs from email links...",
                percent: 15,
                currentStep: 2,
            }), await collectJobsFromEmailLinks(userId, preferences.gmailScanDays))
            : [];
        const { jobs: emailLinkJobs, stats: emailPreferenceStats } = filterJobsBySearchPreferences(rawEmailLinkJobs, preferences);

        console.log(`\n╔════════════════════════════════════════════════════════╗`);
        console.log(`║         JOB AUTOMATION WORKFLOW STARTED                ║`);
        console.log(`║         Source mode: ${sourceMode.padEnd(33, " ")}║`);
        console.log(`╚════════════════════════════════════════════════════════╝`);
        console.log(`[Job Automation] Starting job collection (${sourceMode})...`);

        updateAutomationProgress(userId, {
            stage: sourceMode === "EMAIL" ? "Email links" : "Collecting",
            message: sourceMode === "EMAIL"
                ? "Collecting jobs from email links..."
                : sourceMode === "CENTER_ISRAEL"
                    ? "Collecting jobs from 100 firms..."
                    : "Collecting jobs from providers...",
            percent: sourceMode === "EMAIL" ? 30 : 20,
            currentStep: sourceMode === "EMAIL" ? 3 : 1,
        });

        const providerJobs = sourceMode === "PROVIDERS"
            ? await collectJobs({
                searchLocation,
                preferences,
                userId,
                allowGlobalLinkedInFallback: options.allowGlobalLinkedInFallback,
            })
            : sourceMode === "CENTER_ISRAEL"
                ? await collectJobs({
                    searchLocation,
                    providerNames: ["CENTER_ISRAEL"],
                    preferences,
                    userId,
                    allowGlobalLinkedInFallback: options.allowGlobalLinkedInFallback,
                })
                : [];

        const providerPreferenceStats = (providerJobs as any).preferenceFilterStats;
        const preferenceFilterStats: SearchPreferenceFilterStats = {
            input: emailPreferenceStats.input + (providerPreferenceStats?.input ?? 0),
            output: emailPreferenceStats.output + (providerPreferenceStats?.output ?? 0),
            excludedKeyword: emailPreferenceStats.excludedKeyword + (providerPreferenceStats?.excludedKeyword ?? 0),
            titleStopword: emailPreferenceStats.titleStopword + (providerPreferenceStats?.titleStopword ?? 0),
            excludedCompany: emailPreferenceStats.excludedCompany + (providerPreferenceStats?.excludedCompany ?? 0),
            remote: emailPreferenceStats.remote + (providerPreferenceStats?.remote ?? 0),
            targetRole: emailPreferenceStats.targetRole + (providerPreferenceStats?.targetRole ?? 0),
            targetLocation: emailPreferenceStats.targetLocation + (providerPreferenceStats?.targetLocation ?? 0),
            requiredTech: emailPreferenceStats.requiredTech + (providerPreferenceStats?.requiredTech ?? 0),
            dateRange: emailPreferenceStats.dateRange + (providerPreferenceStats?.dateRange ?? 0),
        };

        const collectedJobs = dedupeJobs([...emailLinkJobs, ...providerJobs]);
        const collectedAllowance = await getVacancyCollectionAllowance(userId);
        const newJobs = collectedJobs.slice(0, collectedAllowance);
        const collectedSkippedByPlan = Math.max(collectedJobs.length - newJobs.length, 0);

        if (newJobs.length > 0) {
            await recordUsageEvent(userId, "VACANCY_COLLECTED", newJobs.length, {
                sourceMode,
                searchLocation,
            });
        }

        console.log(`[Job Automation] Collected ${emailLinkJobs.length} jobs from email links`);
        console.log(`[Job Automation] Collected ${newJobs.length} new unique jobs (after deduplication)`);
        if (collectedSkippedByPlan > 0) {
            console.log(`[Job Automation] Skipped ${collectedSkippedByPlan} jobs because of plan vacancy limit`);
        }

        // ПАРАЛЛЕЛЬНЫЙ АНАЛИЗ
        console.log(`\n[Job Automation] Starting parallel analysis of ${newJobs.length} jobs (concurrency: ${ANALYSIS_CONCURRENCY})...`);

        updateAutomationProgress(userId, {
            stage: "Analyzing",
            message: `Starting parallel analysis of ${newJobs.length} jobs...`,
            percent: 30,
            currentStep: 3,
        });

        const analysisProcessor = async (job: Job, index: number): Promise<AnalyzedJob> => {
            updateAutomationProgress(userId, {
                stage: "Analyzing",
                message: `Analyzing ${index + 1}/${newJobs.length}: ${job.title}`,
                percent: 30 + Math.round((index / Math.max(newJobs.length, 1)) * 35),
                currentStep: 3,
            });

            const selectedResumeBase = await selectResumeBaseForJob(userId, job, resumeBaseId, options.resumeBaseIds);
            selectedResumeBaseIds.set(job.id, selectedResumeBase.id);
            console.log(
                `  ├─ Analyzing: "${job.title}" at ${job.company} ` +
                `[base: ${selectedResumeBase.name}, target: ${selectedResumeBase.inferredTarget}]`,
            );
            const analyzed = await analyzeJob(job.id, {
                userId,
                resumeBaseId: selectedResumeBase.id,
            });

            if (userId) {
                await upsertUserJobMatch(userId, job.id, {
                    matchScore: analyzed.matchScore,
                    analysis: analyzed.analysis,
                });
            }

            console.log(
                `  │  Score: ${analyzed.matchScore}/100 | Recommendation: ${(analyzed.analysis as any)?.recommendation}`,
            );

            return analyzed;
        };

        const { results: analyzedJobs, errors: analysisErrors } = await processBatch(
            newJobs,
            analysisProcessor,
            ANALYSIS_CONCURRENCY,
            (processed, total) => {
                updateAutomationProgress(userId, {
                    stage: "Analyzing",
                    message: `Analyzed ${processed}/${total} jobs`,
                    percent: 30 + Math.round((processed / total) * 35),
                    currentStep: 3,
                });
            }
        );

        const failedAnalysis = analysisErrors.map(e => (e.item as Job).title);

        console.log(`[Job Automation] Analysis complete: ${analyzedJobs.length}/${newJobs.length} succeeded, ${failedAnalysis.length} failed`);

        // ПАРАЛЛЕЛЬНАЯ ГЕНЕРАЦИЯ
        console.log(`\n[Job Automation] Starting parallel resume generation (concurrency: ${GENERATION_CONCURRENCY})...`);

        updateAutomationProgress(userId, {
            stage: "Generating",
            message: "Starting parallel resume generation...",
            percent: 65,
            currentStep: 4,
        });

        // Сначала фильтруем, какие вакансии нужно обрабатывать
        const jobsToGenerate = analyzedJobs.filter(job => {
            const recommendation = (job.analysis as any)?.recommendation;
            if (SKIP_RECOMMENDATIONS.has(recommendation)) {
                console.log(`  ├─ ⊘ Skipped: "${job.title}" (Recommendation: ${recommendation})`);
                return false;
            }
            if (job.matchScore != null && job.matchScore < requiredMatchScore) {
                console.log(`  ├─ ⊘ Skipped: "${job.title}" (Score: ${job.matchScore}/${requiredMatchScore})`);
                return false;
            }
            return true;
        });

        const skippedJobs = analyzedJobs.filter(job => !jobsToGenerate.includes(job)).map(job => ({
            job: job as Job,
            reason: (job.analysis as any)?.recommendation === "SKIP"
                ? `Recommendation: SKIP`
                : `Score ${job.matchScore} < ${requiredMatchScore}`
        }));

        const generationProcessor = async (job: AnalyzedJob, index: number): Promise<{ resume: GeneratedResume; coverLetter: GeneratedCoverLetter }> => {
            updateAutomationProgress(userId, {
                stage: "Generating",
                message: `Generating ${index + 1}/${jobsToGenerate.length}: ${job.title}`,
                percent: 65 + Math.round((index / Math.max(jobsToGenerate.length, 1)) * 20),
                currentStep: 4,
            });

            const selectedResumeBaseId = selectedResumeBaseIds.get(job.id)
                ?? (await selectResumeBaseForJob(userId, job, resumeBaseId, options.resumeBaseIds)).id;
            console.log(`  ├─ ✓ Generating resume and cover letter for: "${job.title}"`);
            const [resume, coverLetter] = await Promise.all([
                generateResumeForJob(job.id, { userId, resumeBaseId: selectedResumeBaseId }),
                generateCoverLetterForJob(job.id, { userId, resumeBaseId: selectedResumeBaseId }),
            ]);

            console.log(
                `  │  Resume saved to: ${resume.filePath ? path.relative(process.cwd(), resume.filePath) : "unknown path"}`,
            );

            return { resume, coverLetter };
        };

        const { results: generationResults, errors: generationErrors } = await processBatch(
            jobsToGenerate,
            generationProcessor,
            GENERATION_CONCURRENCY,
            (processed, total) => {
                updateAutomationProgress(userId, {
                    stage: "Generating",
                    message: `Generated ${processed}/${total} resumes`,
                    percent: 65 + Math.round((processed / total) * 20),
                    currentStep: 4,
                });
            }
        );

        const generatedResumes = generationResults.map(r => r.resume);
        const generatedCoverLetters = generationResults.map(r => r.coverLetter);
        const failedResumes = generationErrors.map(e => ({
            job: e.item as Job,
            error: e.error
        }));

        updateAutomationProgress(userId, {
            stage: "Follow-up",
            message: "Building follow-up summary...",
            percent: 88,
            currentStep: 5,
        });

        const appliedVacancies = (await listAppliedVacancies(userId, 1000)) as Array<{
            title: string;
            company: string;
            status: string;
            source: string;
            jobUrl?: string | null;
            emailSubject?: string | null;
            emailFrom?: string | null;
            lastSeenAt: Date;
        }>;
        const answeredSince = new Date(collectedAt.getTime() - ANSWERED_REPORT_WINDOW_MS);

        const followUp = {
            needsReply: appliedVacancies.filter((vacancy) => NEEDS_REPLY_STATUSES.has(vacancy.status)).map(toFollowUpEntry),
            answered: appliedVacancies
                .filter((vacancy) =>
                    ANSWERED_STATUSES.has(vacancy.status) &&
                    vacancy.lastSeenAt >= answeredSince,
                )
                .map(toFollowUpEntry),
        };

        const message = buildAutomationMessage(
            collectedAt,
            newJobs,
            analyzedJobs,
            generatedResumes,
            generatedCoverLetters,
            skippedJobs,
            failedResumes,
            failedAnalysis,
            sourceMode === "EMAIL" ? emailReport.message : null,
            followUp,
        );

        updateAutomationProgress(userId, {
            stage: "Notification",
            message: "Sending Telegram notification...",
            percent: 94,
            currentStep: 5,
        });

        console.log(`\n[Job Automation] Sending Telegram notification...`);
        const telegramSent = await sendTelegramMessageToUser(userId, message);
        if (telegramSent) {
            console.log(`[Job Automation] ✓ Telegram notification sent successfully`);
        } else {
            console.log(`[Job Automation] ✗ Telegram notification failed (check TELEGRAM_BOT_TOKEN)`);
        }

        console.log(`\n╔════════════════════════════════════════════════════════╗`);
        console.log(`║         WORKFLOW COMPLETE                              ║`);
        console.log(`╠════════════════════════════════════════════════════════╣`);
        console.log(`║ Collected: ${newJobs.length} new jobs`);
        console.log(`║ Analyzed: ${analyzedJobs.length}/${newJobs.length} (Failed: ${failedAnalysis.length})`);
        console.log(`║ Generated Resumes: ${generatedResumes.length}`);
        console.log(`║ Generated Cover Letters: ${generatedCoverLetters.length}`);
        console.log(`║ Skipped: ${skippedJobs.length}`);
        console.log(`║ Preference Filter: ${preferenceFilterStats.output}/${preferenceFilterStats.input} kept`);
        console.log(`║ Failed: ${failedResumes.length}`);
        console.log(`║ Follow-up: ${followUp.needsReply.length} need reply, ${followUp.answered.length} answered`);
        console.log(`╚════════════════════════════════════════════════════════╝\n`);

        finishAutomationProgress(userId, "Workflow finished.");

        return {
            collectedAt,
            searchLocation,
            newJobs,
            analyzedJobs,
            generatedResumes,
            generatedCoverLetters,
            emailReport,
            followUp,
            telegramSent,
            message,
            sourceMode,
            preferenceFilterStats,
            userLimitStats: userId ? {
                userId,
                collectedAllowed: collectedAllowance,
                collectedSkippedByPlan,
            } : undefined,
        };
    } catch (error) {
        failAutomationProgress(userId, error instanceof Error ? error.message : "Automation failed.");
        throw error;
    }
}
