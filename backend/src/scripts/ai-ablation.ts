/**
 * Guardrails ablation: measure the real value of the generation guardrails.
 *
 * For each job, generate the resume two ways (single-shot, no repair loop):
 *   - GUARDED: the production prompt (buildResumePrompt) — allowlist, anti-
 *     fabrication rules, source grounding, summary/Skills consistency.
 *   - NAIVE:   a minimal prompt that just says "maximize keyword match with the
 *     vacancy" — i.e. what a tool WITHOUT guardrails produces.
 *
 * Then compare, per variant:
 *   - fabricated skills: Skills-section items NOT present in the base resume
 *   - hallucination-type ATS issues (keyword-in-summary-not-in-Skills,
 *     unsupported technologies, summary/Skills mismatch)
 *   - mean ATS score and clean-pass rate (score >= ATS_MIN AND 0 hallucination issues)
 *
 * Usage: tsx src/scripts/ai-ablation.ts --email=user@example.com [--n=8]
 */
import OpenAI from "openai";
import { prisma } from "../infrastructure/prisma";
import { buildResumePrompt } from "../services/resume-generator.service";
import { validateResumeAgainstJob } from "../services/ats-resume-validator.service";
import { inferResumeTargetForJob } from "../services/resume-base-selector.service";

const MODEL = process.env.RESUME_GENERATION_MODEL ?? "gpt-4.1-mini";
const ATS_MIN = Number(process.env.ATS_RESUME_MIN_SCORE ?? 75);
const arg = (f: string) => process.argv.find((a) => a.startsWith(`--${f}=`))?.split("=").slice(1).join("=").trim();

const HALLUCINATION_ISSUE =
    /(appears in header\/summary but is missing from Skills|not supported by current role bullets|Summary mentions frontend\/UI experience but Skills does not reflect it)/i;

/** Extract normalized Skills-section items (comma-separated) from a resume markdown. */
function skillsItems(md: string): Set<string> {
    const items = new Set<string>();
    const m = md.match(/(?:^|\n)(?:#{0,3}\s*)?skills\s*\n([\s\S]*?)(?=\n(?:#{0,3}\s*)?(?:experience|work experience|education|projects|personal projects)\b|$)/i);
    const block = m ? m[1] : "";
    for (const line of block.split("\n")) {
        const parts = line.includes(":") ? line.split(":").slice(1).join(":") : line;
        for (const raw of parts.split(",")) {
            const t = raw.trim().toLowerCase().replace(/\(.*?\)/g, "").trim();
            if (t.length >= 2 && t.length <= 40) items.add(t);
        }
    }
    return items;
}

function fabricatedSkills(base: string, generated: string): string[] {
    const baseAll = base.toLowerCase();
    const out: string[] = [];
    for (const item of skillsItems(generated)) {
        // fabricated = a Skills item that does not appear ANYWHERE in the base resume
        const token = item.split(/[\s/]+/)[0];
        if (token.length >= 3 && !baseAll.includes(token)) out.push(item);
    }
    return out;
}

function naivePrompt(job: { title: string; company: string | null; description: string }, base: string): string {
    return `Rewrite the candidate's resume to match the target vacancy as closely as possible and MAXIMIZE ATS keyword match.
Add the skills, technologies, frameworks and keywords from the vacancy that make the candidate look like a strong fit.
Keep sections: "## Summary", "## Skills", "## Experience" with "- " bullets. Return ONLY the resume markdown.

TARGET VACANCY
Title: ${job.title}
Company: ${job.company ?? "n/a"}
${job.description.slice(0, 5000)}

CANDIDATE RESUME
${base}`;
}

async function generate(openai: OpenAI, prompt: string): Promise<string> {
    const r = await openai.chat.completions.create({
        model: MODEL,
        temperature: 0.25,
        messages: [{ role: "user", content: prompt }],
    });
    return r.choices[0].message.content ?? "";
}

type Stat = { score: number; fabricated: number; hallucinationIssues: number };
function summarize(label: string, rows: Stat[]) {
    const n = rows.length || 1;
    const mean = (f: (s: Stat) => number) => rows.reduce((a, s) => a + f(s), 0) / n;
    const withHall = rows.filter((s) => s.hallucinationIssues > 0 || s.fabricated > 0).length;
    const cleanPass = rows.filter((s) => s.score >= ATS_MIN && s.hallucinationIssues === 0 && s.fabricated === 0).length;
    console.log(`\n[${label}]`);
    console.log(`  mean ATS score:            ${mean((s) => s.score).toFixed(1)}`);
    console.log(`  mean fabricated skills:    ${mean((s) => s.fabricated).toFixed(2)}`);
    console.log(`  mean hallucination issues: ${mean((s) => s.hallucinationIssues).toFixed(2)}`);
    console.log(`  resumes w/ any fabrication:${withHall}/${rows.length} (${Math.round((withHall / n) * 100)}%)`);
    console.log(`  clean-pass rate:           ${cleanPass}/${rows.length} (${Math.round((cleanPass / n) * 100)}%)`);
    return { withHallPct: Math.round((withHall / n) * 100), cleanPassPct: Math.round((cleanPass / n) * 100), meanFab: mean((s) => s.fabricated) };
}

async function main() {
    const email = arg("email");
    const user = email
        ? await prisma.appUser.findUniqueOrThrow({ where: { email }, select: { id: true } })
        : (await prisma.appUser.findMany({ select: { id: true } }))[0];
    const n = Number(arg("n") ?? 8);
    const matches = await prisma.userJobMatch.findMany({
        where: { userId: user.id, status: { notIn: ["REJECTED", "IGNORED"] } },
        orderBy: [{ matchScore: "desc" }, { matchedAt: "desc" }],
        take: n + 6,
        select: { jobId: true },
    });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const guarded: Stat[] = [];
    const naive: Stat[] = [];
    let done = 0;

    for (const { jobId } of matches) {
        if (done >= n) break;
        const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
        if (job.description.length < 500) continue;
        const target = inferResumeTargetForJob(job);
        const base =
            (await prisma.userResumeBase.findFirst({ where: { userId: user.id, target } })) ??
            (await prisma.userResumeBase.findFirst({ where: { userId: user.id, isDefault: true } }));
        if (!base) continue;

        try {
            const g = await generate(openai, buildResumePrompt(job, base.content, null));
            const nv = await generate(openai, naivePrompt(job, base.content));
            const gv = validateResumeAgainstJob(job, g);
            const nvv = validateResumeAgainstJob(job, nv);
            const gStat: Stat = { score: gv.score, fabricated: fabricatedSkills(base.content, g).length, hallucinationIssues: gv.issues.filter((i) => HALLUCINATION_ISSUE.test(i)).length };
            const nStat: Stat = { score: nvv.score, fabricated: fabricatedSkills(base.content, nv).length, hallucinationIssues: nvv.issues.filter((i) => HALLUCINATION_ISSUE.test(i)).length };
            guarded.push(gStat);
            naive.push(nStat);
            done += 1;
            const fab = fabricatedSkills(base.content, nv).slice(0, 5).join(", ");
            console.log(`  ${job.title.slice(0, 34).padEnd(34)} guarded ${gStat.score}/fab${gStat.fabricated}  naive ${nStat.score}/fab${nStat.fabricated}  [naive added: ${fab || "-"}]`);
        } catch (e) {
            console.log(`  ${jobId} ERROR: ${(e as Error).message}`);
        }
    }

    console.log(`\n================ GUARDRAILS ABLATION (${done} jobs, ATS_MIN=${ATS_MIN}) ================`);
    const g = summarize("GUARDED (production prompt)", guarded);
    const nsum = summarize("NAIVE (no guardrails)", naive);
    console.log("\n---- DELTA (guardrails' effect) ----");
    console.log(`  fabricated skills / resume: ${nsum.meanFab.toFixed(2)} (naive) → ${g.meanFab.toFixed(2)} (guarded)`);
    console.log(`  resumes with fabrication:   ${nsum.withHallPct}% (naive) → ${g.withHallPct}% (guarded)`);
    console.log(`  clean-pass rate:            ${nsum.cleanPassPct}% (naive) → ${g.cleanPassPct}% (guarded)`);
    console.log("=============================================================");
}

main()
    .catch((e) => {
        console.error(e instanceof Error ? e.message : e);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
