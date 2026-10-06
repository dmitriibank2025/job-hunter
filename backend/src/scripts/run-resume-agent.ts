/**
 * Run the tool-using resume agent on a job and print its tool-call trace.
 * Usage: tsx src/scripts/run-resume-agent.ts --email=user@example.com --job=<jobId>
 */
import { runResumeAgent } from "../services/resume-agent.service";
import { prisma } from "../infrastructure/prisma";

function getArg(f: string) {
    return process.argv.find((a) => a.startsWith(`--${f}=`))?.split("=").slice(1).join("=").trim();
}

async function main() {
    const email = getArg("email");
    const jobId = getArg("job");
    if (!jobId) throw new Error("Pass --job=<jobId>");
    const user = email
        ? await prisma.appUser.findUniqueOrThrow({ where: { email }, select: { id: true } })
        : (await prisma.appUser.findMany({ select: { id: true } }))[0];

    const t0 = Date.now();
    const r = await runResumeAgent(jobId, user.id);
    const ms = Date.now() - t0;

    console.log("=== RESUME AGENT RUN ===");
    console.log(`rounds:        ${r.rounds}`);
    console.log(`search_experience calls: ${r.searchCalls}`);
    console.log(`score_document calls:    ${r.scoreCalls}`);
    console.log(`score trace:   ${r.scoreTrace.join(" → ") || "(none)"}`);
    console.log(`final score:   ${r.finalScore}`);
    console.log(`wall time:     ${ms}ms`);
    console.log(`content chars: ${r.content.length}`);
    console.log("\n--- first 600 chars of output ---\n" + r.content.slice(0, 600));
}

main()
    .catch((e) => {
        console.error(e instanceof Error ? e.message : e);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
