import { prisma } from "../infrastructure/prisma";
import { indexCandidateRevision } from "./embedding.service";

const DEFAULT_INTERVAL_MS = 60_000;
let timer: NodeJS.Timeout | undefined;
let running = false;

export async function processCandidateIndexJob(jobId: string): Promise<"completed" | "superseded" | "skipped"> {
    const claimed = await prisma.candidateIndexJob.updateMany({
        where: { id: jobId, status: { in: ["PENDING", "FAILED"] }, attempts: { lt: 5 } },
        data: { status: "PROCESSING", attempts: { increment: 1 }, lastError: null },
    });
    if (claimed.count !== 1) return "skipped";

    const job = await prisma.candidateIndexJob.findUniqueOrThrow({
        where: { id: jobId },
        include: { user: { select: { candidateRevision: true } } },
    });
    if (job.user.candidateRevision !== job.revision) {
        await prisma.candidateIndexJob.update({
            where: { id: job.id }, data: { status: "COMPLETED", lastError: "SUPERSEDED_BY_NEWER_REVISION" },
        });
        return "superseded";
    }

    try {
        await indexCandidateRevision(job.userId, job.revision);
        await prisma.candidateIndexJob.update({
            where: { id: job.id }, data: { status: "COMPLETED", lastError: null },
        });
        return "completed";
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await prisma.candidateIndexJob.update({
            where: { id: job.id }, data: { status: "FAILED", lastError: message.slice(0, 4000) },
        });
        throw error;
    }
}

export async function processPendingCandidateIndexJobs(limit = 5): Promise<number> {
    if (running) return 0;
    running = true;
    try {
        const jobs = await prisma.candidateIndexJob.findMany({
            where: { status: { in: ["PENDING", "FAILED"] }, attempts: { lt: 5 } },
            orderBy: [{ revision: "desc" }, { updatedAt: "asc" }],
            take: limit,
            select: { id: true },
        });
        let completed = 0;
        for (const job of jobs) {
            try {
                const status = await processCandidateIndexJob(job.id);
                if (status !== "skipped") completed += 1;
            } catch (error) {
                console.error(`[candidate-index] Job ${job.id} failed:`, error);
            }
        }
        return completed;
    } finally {
        running = false;
    }
}

export function startCandidateIndexSchedule(intervalMs = DEFAULT_INTERVAL_MS) {
    if (timer || process.env.CANDIDATE_INDEX_WORKER_ENABLED === "false") return;
    void processPendingCandidateIndexJobs();
    timer = setInterval(() => void processPendingCandidateIndexJobs(), intervalMs);
    timer.unref();
    console.log(`Candidate RAG index worker started (${intervalMs}ms interval)`);
}

export function stopCandidateIndexSchedule() {
    if (timer) clearInterval(timer);
    timer = undefined;
}
