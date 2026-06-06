import cron from "node-cron";
import { runJobAutomationWorkflowWithSource } from "./job-automation.service";

let scheduled = false;
let scheduledTask: ReturnType<typeof cron.schedule> | undefined;

export function startDailyJobReportSchedule() {
    if (scheduled) return;

    const enabled = process.env.DAILY_JOB_REPORT_ENABLED !== "false";

    if (!enabled) {
        console.log("Daily job report scheduler disabled");
        return;
    }

    const expression = process.env.JOB_REPORT_CRON ?? "0 9 * * *";
    const timezone = process.env.JOB_REPORT_TIMEZONE ?? "Asia/Jerusalem";

    scheduledTask = cron.schedule(
        expression,
        async () => {
            try {
                const report = await runJobAutomationWorkflowWithSource({
                    sourceMode: "PROVIDERS",
                    searchLocation: process.env.JOB_SEARCH_LOCATION,
                });
                console.log(
                    `Daily provider automation completed: ${report.newJobs.length} jobs, ${report.analyzedJobs.length} analyzed, ${report.generatedResumes.length} resumes, telegramSent=${report.telegramSent}`,
                );
            } catch (error) {
                console.error("Daily provider automation failed", error);
            }
        },
        {
            timezone,
        },
    );

    scheduled = true;
    console.log(`Daily provider automation scheduler started: ${expression} (${timezone})`);
}

export function stopDailyJobReportSchedule() {
    scheduledTask?.stop();
    scheduledTask?.destroy?.();
    scheduledTask = undefined;
    scheduled = false;
}
