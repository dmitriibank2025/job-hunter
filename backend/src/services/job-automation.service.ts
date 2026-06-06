import { Job } from "@prisma/client";
import path from "path";
import { collectJobs } from "./job-collector.service";
import { collectJobsFromEmailLinks } from "./email-link-job-collector.service";
import { generateCoverLetterForJob, generateResumeForJob } from "./resume-generator.service";
import { runEmailReport } from "./email-report.service";
import { listAppliedVacancies } from "./applied-vacancy.service";
import { sendTelegramMessage } from "./telegram.service";
import { analyzeJob } from "./job-analyzer.service";
import {
    filterJobsBySearchPreferences,
    normalizeSearchPreferences,
    SearchPreferenceFilterStats,
    SearchPreferences,
} from "./search-preferences.service";
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

    const limit = Number(process.env.JOB_REPORT_LIMIT ?? 10);
    const shown = entries.slice(0, Number.isFinite(limit) && limit > 0 ? limit : 10);
    const omitted = Math.max(entries.length - shown.length, 0);

    return [
        title,
        shown.map((entry, index) => `${index + 1}. ${formatFollowUpEntry(entry)}`).join("\n\n"),
        omitted > 0 ? `\n...and ${omitted} more.` : "",
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

     // Summary stats
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

     // Generated resumes with submission info
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

     // Skipped jobs explanation
     if (skippedJobs.length > 0) {
         const limit = 5;
         const shown = skippedJobs.slice(0, limit);
         const omitted = Math.max(skippedJobs.length - limit, 0);

         sections.push(
             `⊘ SKIPPED (Not Matching) (${skippedJobs.length})`,
             "",
         );

         for (let i = 0; i < shown.length; i++) {
             const {job, reason} = shown[i];
             sections.push(
                 `${i + 1}. ${job.title} @ ${job.company}`,
                 `   Reason: ${reason}`,
             );
         }

         if (omitted > 0) {
             sections.push(`\n...and ${omitted} more skipped jobs`);
         }
         sections.push("");
     }

     // Failed resumes
     if (failedResumes.length > 0) {
         sections.push(
             `❌ FAILED RESUMES (${failedResumes.length})`,
             "",
         );

         for (const {job, error} of failedResumes.slice(0, 3)) {
             sections.push(
                 `• ${job.title} @ ${job.company}`,
                 `  Error: ${error}`,
             );
         }
         sections.push("");
     }

     // Follow-up section
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

export async function runJobAutomationWorkflow(searchLocation?: string): Promise<JobAutomationReport> {
    return runJobAutomationWorkflowWithSource({ searchLocation, sourceMode: "PROVIDERS" });
}

export async function runJobAutomationWorkflowWithSource(options: {
    searchLocation?: string;
    sourceMode?: JobAutomationSourceMode;
    preferences?: SearchPreferences;
    userId?: string;
    resumeBaseId?: string;
}): Promise<JobAutomationReport> {
    const { searchLocation, sourceMode = "PROVIDERS" } = options;
    const { userId, resumeBaseId } = options;
    if (!userId) {
        throw new Error("userId is required for job automation workflow");
    }
    const preferences = normalizeSearchPreferences(options.preferences);
    const requiredMatchScore = preferences.minMatchScore ?? REQUIRED_MATCH_SCORE;
    const collectedAt = new Date();
    startAutomationProgress(5);

    try {
        await assertUserLimit(userId, "SEARCH_RUN");
        await recordUsageEvent(userId, "SEARCH_RUN", 1, { sourceMode, searchLocation });

        const emailReport = sourceMode === "EMAIL"
            ? (updateAutomationProgress({
                stage: "Email report",
                message: "Reading email report...",
                percent: 5,
                currentStep: 1,
            }), await runEmailReport(userId))
            : emptyEmailReport();

        const rawEmailLinkJobs = sourceMode === "EMAIL"
            ? (updateAutomationProgress({
                stage: "Email links",
                message: "Collecting jobs from email links...",
                percent: 15,
                currentStep: 2,
            }), await collectJobsFromEmailLinks(userId))
            : [];
        const { jobs: emailLinkJobs, stats: emailPreferenceStats } = filterJobsBySearchPreferences(rawEmailLinkJobs, preferences);

        console.log(`\n╔════════════════════════════════════════════════════════╗`);
        console.log(`║         JOB AUTOMATION WORKFLOW STARTED                ║`);
        console.log(`╚════════════════════════════════════════════════════════╝`);
        console.log(`[Job Automation] Starting job collection...`);

        updateAutomationProgress({
            stage: sourceMode === "EMAIL" ? "Providers" : "Collecting",
            message: sourceMode === "EMAIL"
                ? "Collecting jobs from providers..."
                : sourceMode === "CENTER_ISRAEL"
                    ? "Collecting jobs from 100 firms..."
                    : "Collecting jobs from providers...",
            percent: sourceMode === "EMAIL" ? 30 : 20,
            currentStep: sourceMode === "EMAIL" ? 3 : 1,
        });
        const providerJobs = sourceMode === "PROVIDERS"
            ? await collectJobs({ searchLocation, preferences, userId })
            : sourceMode === "CENTER_ISRAEL"
                ? await collectJobs({ searchLocation, providerNames: ["CENTER_ISRAEL"], preferences, userId })
                : [];
        const providerPreferenceStats = providerJobs.preferenceFilterStats;
        const preferenceFilterStats: SearchPreferenceFilterStats = {
            input: emailPreferenceStats.input + (providerPreferenceStats?.input ?? 0),
            output: emailPreferenceStats.output + (providerPreferenceStats?.output ?? 0),
            excludedKeyword: emailPreferenceStats.excludedKeyword + (providerPreferenceStats?.excludedKeyword ?? 0),
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

        console.log(`\n[Job Automation] Starting analysis of ${newJobs.length} jobs...`);
        const analyzedJobs: AnalyzedJob[] = [];
        const failedAnalysis: string[] = [];

        for (let index = 0; index < newJobs.length; index++) {
            const job = newJobs[index];

            updateAutomationProgress({
                stage: "Analyzing",
                message: `Analyzing ${index + 1}/${newJobs.length}: ${job.title}`,
                percent: 30 + Math.round((index / Math.max(newJobs.length, 1)) * 35),
                currentStep: 3,
            });

            try {
                console.log(`  ├─ Analyzing: "${job.title}" at ${job.company}`);
                const analyzed = await analyzeJob(job.id, { userId, resumeBaseId });
                if (userId) {
                    await upsertUserJobMatch(userId, job.id, {
                        matchScore: analyzed.matchScore,
                        analysis: analyzed.analysis,
                    });
                }
                analyzedJobs.push(analyzed);
                console.log(
                    `  │  Score: ${analyzed.matchScore}/100 | Recommendation: ${(analyzed.analysis as any)?.recommendation}`,
                );
            } catch (error) {
                failedAnalysis.push(job.title);
                console.error(`  ├─ ✗ Analysis failed for "${job.title}":`, (error as any).message);
            }
        }

        console.log(`\n[Job Automation] Starting resume generation...`);
        const generatedResumes: GeneratedResume[] = [];
        const generatedCoverLetters: GeneratedCoverLetter[] = [];
        const skippedJobs: Array<{ job: Job; reason: string }> = [];
        const failedResumes: Array<{ job: Job; error: string }> = [];

        for (let index = 0; index < analyzedJobs.length; index++) {
            const job = analyzedJobs[index];
            const recommendation = (job.analysis as any)?.recommendation;

            updateAutomationProgress({
                stage: "Generating",
                message: `Generating resume ${index + 1}/${analyzedJobs.length}: ${job.title}`,
                percent: 65 + Math.round((index / Math.max(analyzedJobs.length, 1)) * 20),
                currentStep: 4,
            });

            if (SKIP_RECOMMENDATIONS.has(recommendation)) {
                skippedJobs.push({ job, reason: `Recommendation: ${recommendation}` });
                console.log(`  ├─ ⊘ Skipped: "${job.title}" (Recommendation: ${recommendation})`);
                continue;
            }

            if (job.matchScore && job.matchScore < requiredMatchScore) {
                skippedJobs.push({ job, reason: `Score ${job.matchScore} < ${requiredMatchScore}` });
                console.log(`  ├─ ⊘ Skipped: "${job.title}" (Score: ${job.matchScore}/${requiredMatchScore})`);
                continue;
            }

            try {
                console.log(`  ├─ ✓ Generating resume and cover letter for: "${job.title}"`);
                const [resume, coverLetter] = await Promise.all([
                    generateResumeForJob(job.id, { userId, resumeBaseId }),
                    generateCoverLetterForJob(job.id, { userId, resumeBaseId }),
                ]);
                generatedResumes.push(resume);
                generatedCoverLetters.push(coverLetter);
                console.log(
                    `  │  Resume saved to: ${resume.filePath ? path.relative(process.cwd(), resume.filePath) : "unknown path"}`,
                );
            } catch (error) {
                failedResumes.push({ job, error: (error as any).message });
                console.error(`  ├─ ✗ Resume generation failed for "${job.title}":`, (error as any).message);
            }
        }

        updateAutomationProgress({
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

        updateAutomationProgress({
            stage: "Notification",
            message: "Sending Telegram notification...",
            percent: 94,
            currentStep: 5,
        });
        console.log(`\n[Job Automation] Sending Telegram notification...`);
        const telegramSent = await sendTelegramMessage(message);
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

        finishAutomationProgress("Workflow finished.");

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
        failAutomationProgress(error instanceof Error ? error.message : "Automation failed.");
        throw error;
    }
 }
