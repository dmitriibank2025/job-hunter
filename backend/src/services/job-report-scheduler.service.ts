import cron from "node-cron";
import { prisma } from "../infrastructure/prisma";
import { runJobAutomationWorkflowWithSource } from "./job-automation.service";
import { ResumeBaseSelectionMap } from "./resume-base-selector.service";
import { SearchPreferences } from "./search-preferences.service";

let scheduled = false;
let scheduledTask: ReturnType<typeof cron.schedule> | undefined;
let isRunning = false; // Предотвращаем одновременный запуск

function freshJobPreferences(): SearchPreferences {
    const dateRangeDays = Number(process.env.DAILY_FRESH_JOB_RANGE_DAYS ?? 1);
    const minMatchScore = Number(process.env.MIN_MATCH_SCORE ?? 70);

    const excludedKeywordsRaw = process.env.JOB_SEARCH_EXCLUDED_KEYWORDS ?? "";
    const excludedKeywords = excludedKeywordsRaw
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);

    return {
        dateRangeDays: Number.isFinite(dateRangeDays) && dateRangeDays > 0 ? dateRangeDays : 1,
        minMatchScore: Number.isFinite(minMatchScore) ? minMatchScore : 70,
        excludedKeywords: excludedKeywords.length > 0 ? excludedKeywords : undefined,
    };
}

async function listUsersForDailyFreshJobCheck() {
    return prisma.appUser.findMany({
        where: {
            status: "ACTIVE",
            dailyAutomationEnabled: true,
            profile: { isNot: null },
            resumeBases: { some: {} },
        },
        include: {
            resumeBases: {
                orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
                take: 1,
            },
        },
        orderBy: { createdAt: "asc" },
    });
}

function localDateParts(date: Date, timezone: string) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).formatToParts(date);
    const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";

    return {
        runKey: `${value("year")}-${value("month")}-${value("day")}`,
        time: `${value("hour")}:${value("minute")}`,
    };
}

function timeToMinutes(value: string): number | null {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
    if (!match) return null;

    return Number(match[1]) * 60 + Number(match[2]);
}

function isUserDueForDailyRun(user: Awaited<ReturnType<typeof listUsersForDailyFreshJobCheck>>[number], now: Date) {
    const local = localDateParts(now, user.dailyAutomationTimezone);
    const currentMinutes = timeToMinutes(local.time);
    const scheduledMinutes = timeToMinutes(user.dailyAutomationTime);

    return currentMinutes !== null &&
        scheduledMinutes !== null &&
        currentMinutes >= scheduledMinutes &&
        user.dailyAutomationLastRunKey !== local.runKey
        ? local.runKey
        : null;
}

export async function runDailyFreshJobChecks(options: { force?: boolean; quiet?: boolean } = {}) {
    const users = await listUsersForDailyFreshJobCheck();
    const preferences = freshJobPreferences();
    const allowGlobalLinkedInFallback = process.env.DAILY_LINKEDIN_GLOBAL_FALLBACK !== "false";
    const now = new Date();
    const results: Array<{
        userId: string;
        email: string;
        newJobs: number;
        analyzedJobs: number;
        generatedResumes: number;
        generatedCoverLetters: number;
        telegramSent: boolean;
    }> = [];
    const failures: Array<{ userId: string; email: string; error: string }> = [];
    let dueUsers = 0;

    if (!options.quiet) {
        console.log(`[Scheduler] Daily fresh job check: ${users.length} enabled active users with base resumes`);
    }

    for (const user of users) {
        const resumeBaseId = user.resumeBases[0]?.id;
        if (!resumeBaseId) continue;
        const runKey = options.force ? localDateParts(now, user.dailyAutomationTimezone).runKey : isUserDueForDailyRun(user, now);
        if (!runKey) continue;
        dueUsers++;

        try {
            const resumeBaseIds: ResumeBaseSelectionMap = {
                FULLSTACK: user.dailyAutomationFullstackResumeBaseId ?? undefined,
                BACKEND: user.dailyAutomationBackendResumeBaseId ?? undefined,
                FRONTEND: user.dailyAutomationFrontendResumeBaseId ?? undefined,
            };
            const report = await runJobAutomationWorkflowWithSource({
                userId: user.id,
                resumeBaseId,
                resumeBaseIds,
                sourceMode: "PROVIDERS",
                searchLocation: process.env.JOB_SEARCH_LOCATION,
                preferences,
                allowGlobalLinkedInFallback,
            });

            await prisma.appUser.update({
                where: { id: user.id },
                data: { dailyAutomationLastRunKey: runKey },
            });

            results.push({
                userId: user.id,
                email: user.email,
                newJobs: report.newJobs.length,
                analyzedJobs: report.analyzedJobs.length,
                generatedResumes: report.generatedResumes.length,
                generatedCoverLetters: report.generatedCoverLetters.length,
                telegramSent: report.telegramSent,
            });

            console.log(
                `[Scheduler] ${user.email}: ${report.newJobs.length} fresh jobs, ` +
                `${report.analyzedJobs.length} analyzed, ${report.generatedResumes.length} resumes`,
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            failures.push({ userId: user.id, email: user.email, error: message });
            console.error(`[Scheduler] ${user.email}: daily fresh job check failed`, error);
        }
    }

    return { users: users.length, dueUsers, results, failures };
}

export function startDailyJobReportSchedule() {
    if (scheduled) return;

    const enabled = process.env.DAILY_JOB_REPORT_ENABLED !== "false";

    if (!enabled) {
        console.log("Daily job report scheduler disabled");
        return;
    }

    const expression = process.env.JOB_REPORT_CRON ?? "0 9 * * *";
    const tickExpression = process.env.DAILY_JOB_CHECK_CRON ?? "* * * * *";
    const timezone = process.env.JOB_REPORT_TIMEZONE ?? "Asia/Jerusalem";

    scheduledTask = cron.schedule(
        tickExpression,
        async () => {
            // Предотвращаем одновременный запуск если предыдущий еще не завершен
            if (isRunning) {
                console.log("Previous automation still running, skipping this schedule tick");
                return;
            }

            isRunning = true;
            const startTime = Date.now();

            try {
                const report = await runDailyFreshJobChecks({ quiet: true });
                if (report.dueUsers === 0 && report.failures.length === 0) return;

                const duration = ((Date.now() - startTime) / 1000).toFixed(1);

                console.log(
                    `[Scheduler] Daily provider automation completed in ${duration}s: ` +
                    `${report.results.reduce((sum, item) => sum + item.newJobs, 0)} jobs, ` +
                    `${report.results.reduce((sum, item) => sum + item.analyzedJobs, 0)} analyzed, ` +
                    `${report.results.reduce((sum, item) => sum + item.generatedResumes, 0)} resumes, ` +
                    `${report.failures.length} failures`
                );
            } catch (error) {
                console.error("[Scheduler] Daily provider automation failed", error);
            } finally {
                isRunning = false;
            }
        },
        {
            timezone,
        }
    );

    scheduled = true;

    // Запускаем при старте если включено (через setTimeout вместо runOnInit)
    if (process.env.JOB_REPORT_RUN_ON_START === "true") {
        setTimeout(() => {
            if (scheduledTask && !isRunning) {
                console.log("[Scheduler] Running initial automation on start");
                scheduledTask.start();
                // Триггерим выполнение
                Promise.resolve().then(async () => {
                    if (scheduledTask && !isRunning) {
                        isRunning = true;
                        try {
                            const report = await runDailyFreshJobChecks();
                            console.log(
                                `[Scheduler] Initial automation completed: ` +
                                `${report.results.reduce((sum, item) => sum + item.newJobs, 0)} new jobs, ` +
                                `${report.failures.length} failures`,
                            );
                        } catch (error) {
                            console.error("[Scheduler] Initial automation failed", error);
                        } finally {
                            isRunning = false;
                        }
                    }
                });
            }
        }, 5000); // Задержка 5 секунд после запуска
    }

    console.log(`Daily provider automation scheduler started: ${tickExpression} (${timezone}); default user time ${expression}`);
}

export function stopDailyJobReportSchedule() {
    if (scheduledTask) {
        scheduledTask.stop();
        scheduledTask.destroy();
        scheduledTask = undefined;
    }
    scheduled = false;
    isRunning = false;
    console.log("Daily provider automation scheduler stopped");
}

// Функция для проверки статуса
export function isSchedulerRunning(): boolean {
    return scheduled && !isRunning;
}

export function getSchedulerStatus(): {
    enabled: boolean;
    running: boolean;
    expression: string;
    timezone: string;
} {
    return {
        enabled: scheduled,
        running: isRunning,
        expression: process.env.DAILY_JOB_CHECK_CRON ?? "* * * * *",
        timezone: process.env.JOB_REPORT_TIMEZONE ?? "Asia/Jerusalem",
    };
}

// Функция для ручного запуска (можно вызвать из API)
export async function runSchedulerNow(): Promise<void> {
    if (isRunning) {
        throw new Error("Scheduler is already running");
    }

    isRunning = true;
    try {
        const report = await runDailyFreshJobChecks({ force: true });
        console.log(
            `[Scheduler] Manual run completed: ` +
            `${report.results.reduce((sum, item) => sum + item.newJobs, 0)} new jobs, ` +
            `${report.failures.length} failures`,
        );
    } finally {
        isRunning = false;
    }
}
