import { app } from "./app";
import { requireEncryptionKeyInProduction } from "./infrastructure/field-encryption.js";
import { validateEnv } from "./config/env";
import { prisma } from "./infrastructure/prisma";
import { startDailyJobReportSchedule, stopDailyJobReportSchedule } from "./services/job-report-scheduler.service";

validateEnv();
requireEncryptionKeyInProduction();

let shuttingDown = false;
let server: ReturnType<typeof app.listen> | undefined;

async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`Received ${signal}, shutting down...`);

    stopDailyJobReportSchedule();

    await new Promise<void>((resolve) => {
        if (!server) {
            resolve();
            return;
        }

        server.close((error) => {
            if (error) {
                console.error("Failed to close HTTP server", error);
            }
            resolve();
        });
    });

    await prisma.$disconnect();
    process.exit(0);
}

process.on("SIGINT", () => {
    void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
});

const port = process.env.PORT || 4000;

server = app.listen(port, () => {
    console.log(`Job Hunter API running on port ${port}`);
    startDailyJobReportSchedule();
});
