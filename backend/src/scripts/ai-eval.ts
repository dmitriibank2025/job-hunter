/**
 * AI generation eval harness.
 *
 * Runs the resume-generation pipeline over a fixed set of jobs and reports real,
 * defensible metrics for the agentic generate -> evaluate -> repair loop:
 *   - pass@ATS_MIN before vs after the repair loop (success rate)
 *   - mean / median ATS score lift from repair
 *   - mean tokens per generation and total tokens
 *   - p50 / p95 LLM latency (from recorded usage-event metadata) and wall latency
 *
 * Data source: the pipeline already records, per attempt, an ATS_RESUME_VALIDATION
 * usage event (attempt 0 = pre-repair, best = post-repair) and per LLM call an
 * OPENAI_TOKENS usage event carrying { latencyMs, promptTokens, completionTokens }.
 *
 * Usage:
 *   tsx src/scripts/ai-eval.ts --email=user@example.com [--n=8] [--jobs=id1,id2,...]
 */
import { generateResumeForJob } from "../services/resume-generator.service";
import { prisma } from "../infrastructure/prisma";

const ATS_MIN = Number(process.env.ATS_RESUME_MIN_SCORE ?? 75);

function getArg(flag: string): string | undefined {
    const hit = process.argv.find((a) => a.startsWith(`--${flag}=`));
    return hit?.split("=").slice(1).join("=").trim() || undefined;
}

function pct(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
}
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const median = (v: number[]) => pct(v, 50);

type Row = {
    jobId: string;
    title: string;
    company: string | null;
    scoreBefore: number | null;
    scoreAfter: number;
    tokens: number;
    llmLatencies: number[];
    wallMs: number;
};

async function resolveUserId(): Promise<string> {
    const email = getArg("email");
    if (email) return (await prisma.appUser.findUniqueOrThrow({ where: { email } })).id;
    const users = await prisma.appUser.findMany({ select: { id: true, email: true } });
    if (users.length === 1) return users[0].id;
    throw new Error(`Specify --email. Users:\n${users.map((u) => `  ${u.id} ${u.email}`).join("\n")}`);
}

async function pickJobs(userId: string): Promise<string[]> {
    const pinned = getArg("jobs");
    if (pinned) return pinned.split(",").map((s) => s.trim()).filter(Boolean);
    const n = Number(getArg("n") ?? 8);
    const rows = await prisma.userJobMatch.findMany({
        where: { userId, status: { notIn: ["REJECTED", "IGNORED"] } },
        orderBy: [{ matchScore: "desc" }, { matchedAt: "desc" }],
        take: n,
        select: { jobId: true },
    });
    return rows.map((r) => r.jobId);
}

async function readbackMetrics(userId: string, jobId: string, since: Date) {
    const events = await prisma.userUsageEvent.findMany({
        where: { userId, type: "OPENAI_TOKENS", createdAt: { gte: since } },
        select: { amount: true, metadata: true },
    });
    let scoreBefore: number | null = null;
    let scoreAfter = -Infinity;
    let tokens = 0;
    const llmLatencies: number[] = [];
    for (const e of events) {
        const m = (e.metadata ?? {}) as Record<string, unknown>;
        if (m.jobId !== jobId) continue;
        if (m.event === "ATS_RESUME_VALIDATION") {
            const score = Number(m.atsScore);
            const attempt = Number(m.attempt);
            if (attempt === 0) scoreBefore = score;
            if (Number.isFinite(score)) scoreAfter = Math.max(scoreAfter, score);
        } else if (e.amount > 0) {
            tokens += e.amount;
            if (typeof m.latencyMs === "number") llmLatencies.push(m.latencyMs);
        }
    }
    return { scoreBefore, scoreAfter: Number.isFinite(scoreAfter) ? scoreAfter : 0, tokens, llmLatencies };
}

async function main() {
    const userId = await resolveUserId();
    const jobIds = await pickJobs(userId);
    if (jobIds.length === 0) throw new Error("No jobs to evaluate.");
    console.log(`AI eval over ${jobIds.length} jobs (ATS_MIN=${ATS_MIN}). Job set: ${jobIds.join(",")}\n`);

    const rows: Row[] = [];
    for (const jobId of jobIds) {
        const since = new Date();
        const t0 = Date.now();
        try {
            const r = await generateResumeForJob(jobId, { userId });
            const wallMs = Date.now() - t0;
            const m = await readbackMetrics(userId, jobId, since);
            const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId }, select: { title: true, company: true } });
            rows.push({ jobId, title: job.title, company: job.company, ...m, wallMs, scoreAfter: r.atsScore ?? m.scoreAfter });
            const lift = m.scoreBefore == null ? "n/a" : `${(r.atsScore ?? m.scoreAfter) - m.scoreBefore >= 0 ? "+" : ""}${(r.atsScore ?? m.scoreAfter) - m.scoreBefore}`;
            console.log(`  ${job.title.slice(0, 40).padEnd(40)} ${m.scoreBefore ?? "?"}→${r.atsScore} (${lift}) ${m.tokens}tok ${wallMs}ms`);
        } catch (e) {
            console.log(`  ${jobId} ERROR: ${(e as Error).message}`);
        }
    }

    const before = rows.map((r) => r.scoreBefore).filter((s): s is number => s != null);
    const after = rows.map((r) => r.scoreAfter);
    const lifts = rows.filter((r) => r.scoreBefore != null).map((r) => r.scoreAfter - (r.scoreBefore as number));
    const allLat = rows.flatMap((r) => r.llmLatencies);
    const passBefore = before.filter((s) => s >= ATS_MIN).length;
    const passAfter = after.filter((s) => s >= ATS_MIN).length;
    const n = rows.length;
    const p = (x: number) => `${Math.round((x / n) * 100)}%`;

    console.log("\n================ AI EVAL REPORT ================");
    console.log(`Eval set:              ${n} jobs`);
    console.log(`pass@${ATS_MIN} pre-repair:    ${passBefore}/${n} (${p(passBefore)})`);
    console.log(`pass@${ATS_MIN} post-repair:   ${passAfter}/${n} (${p(passAfter)})`);
    console.log(`mean score:            ${mean(before).toFixed(1)} → ${mean(after).toFixed(1)}`);
    console.log(`mean score lift:       +${mean(lifts).toFixed(1)} (median +${median(lifts)})`);
    console.log(`tokens / generation:   mean ${Math.round(mean(rows.map((r) => r.tokens)))}, total ${rows.reduce((a, r) => a + r.tokens, 0)}`);
    console.log(`LLM latency:           p50 ${Math.round(median(allLat))}ms, p95 ${Math.round(pct(allLat, 95))}ms (${allLat.length} calls)`);
    console.log(`wall latency / gen:    p50 ${Math.round(median(rows.map((r) => r.wallMs)))}ms, p95 ${Math.round(pct(rows.map((r) => r.wallMs), 95))}ms`);
    console.log("===============================================");
}

main()
    .catch((err) => {
        console.error(err instanceof Error ? err.message : err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
