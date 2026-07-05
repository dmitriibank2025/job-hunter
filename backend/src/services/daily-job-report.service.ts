import { Job } from "@prisma/client";
import { collectJobs } from "./job-collector.service";
import { sendTelegramMessageToUser } from "./telegram.service";
import { runEmailReport } from "./email-report.service";

type DailyJobReport = {
    collectedAt: Date;
    newJobs: Job[];
    emailReport: Awaited<ReturnType<typeof runEmailReport>>;
    telegramSent: boolean;
    message: string;
};

function formatDate(date: Date): string {
    return new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: process.env.JOB_REPORT_TIMEZONE ?? "Asia/Jerusalem",
    }).format(date);
}

function sourceCounts(jobs: Job[]): string {
    const counts = new Map<string, number>();

    for (const job of jobs) {
        const source = job.source ?? "UNKNOWN";
        counts.set(source, (counts.get(source) ?? 0) + 1);
    }

    if (counts.size === 0) return "No new jobs by source.";

    return Array.from(counts.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([source, count]) => `- ${source}: ${count}`)
        .join("\n");
}

function formatJob(job: Job, index: number): string {
    const company = job.company ?? "Unknown company";
    const location = job.location ?? "Unknown location";
    const postedAt = job.postedAt ? ` | posted ${formatDate(job.postedAt)}` : "";
    const url = job.url ? `\n${job.url}` : "";

    return `${index}. ${job.title}\n${company} | ${location} | ${job.source ?? "UNKNOWN"}${postedAt}${url}`;
}

export function buildDailyJobReportMessage(
    newJobs: Job[],
    emailReportMessage?: string,
    collectedAt = new Date(),
): string {
    const limit = Number(process.env.JOB_REPORT_LIMIT ?? 20);
    const shownJobs = newJobs.slice(0, Number.isFinite(limit) && limit > 0 ? limit : 20);
    const omittedCount = Math.max(newJobs.length - shownJobs.length, 0);

    const jobsText =
        shownJobs.length > 0
            ? shownJobs.map((job, index) => formatJob(job, index + 1)).join("\n\n")
            : "No new non-duplicate jobs found today.";

    const omittedText = omittedCount > 0 ? `\n\n...and ${omittedCount} more new jobs.` : "";

    return [
        "Daily Job Hunter Report",
        `Time: ${formatDate(collectedAt)}`,
        `New non-duplicate jobs: ${newJobs.length}`,
        "",
        "Sources:",
        sourceCounts(newJobs),
        "",
        "Jobs:",
        jobsText + omittedText,
        "",
        emailReportMessage ?? "Email report skipped.",
    ].join("\n");
}

export async function runDailyJobReport(userId: string): Promise<DailyJobReport> {
    const collectedAt = new Date();
    const newJobs = await collectJobs({ userId });
    const emailReport = await runEmailReport(userId);
    const message = buildDailyJobReportMessage(newJobs, emailReport.message, collectedAt);
    const telegramSent = await sendTelegramMessageToUser(userId, message);

    return {
        collectedAt,
        newJobs,
        emailReport,
        telegramSent,
        message,
    };
}
