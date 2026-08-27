/**
 * Tool-using resume agent (OpenAI function calling).
 *
 * A ReAct-style loop where the model plans and calls real external tools instead
 * of doing everything in one prompt:
 *   - search_experience(query): vector search (pgvector / embeddings) over the
 *     candidate's real experience corpus — RAG grounding.
 *   - score_document(markdown): the ATS/rubric evaluator — the agent scores and
 *     critiques its own draft, then revises (planner → executor → critic).
 *
 * Kept separate from the deterministic generateResumeForJob pipeline so the
 * production path stays stable; this demonstrates the agentic, tool-driven path.
 */
import OpenAI from "openai";
import type {
    ChatCompletionMessageParam,
    ChatCompletionTool,
} from "openai/resources/chat/completions";
import { prisma } from "../infrastructure/prisma";
import { validateResumeAgainstJob } from "./ats-resume-validator.service";
import { inferResumeTargetForJob } from "./resume-base-selector.service";
import { retrieveRelevantChunks } from "./embedding.service";

const MODEL = process.env.RESUME_AGENT_MODEL ?? "gpt-4.1-mini";

let _client: OpenAI | null = null;
function client(): OpenAI {
    if (_client) return _client;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
    _client = new OpenAI({ apiKey });
    return _client;
}

const tools: ChatCompletionTool[] = [
    {
        type: "function",
        function: {
            name: "search_experience",
            description:
                "Vector search over the candidate's REAL experience corpus. Returns the most relevant bullets for a query. Call this to gather evidence before writing; never claim experience you did not retrieve or that is not in the base resume.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "What to look for, e.g. 'event-driven AWS backend' or 'React dashboards'." },
                    k: { type: "integer", description: "How many results (1-10).", minimum: 1, maximum: 10 },
                },
                required: ["query"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "score_document",
            description:
                "Score a full resume (markdown) against the target vacancy using the ATS/rubric evaluator. Returns score 0-100 and concrete issues. Use it to critique and revise your draft before finalizing.",
            parameters: {
                type: "object",
                properties: { markdown: { type: "string", description: "The complete resume in markdown." } },
                required: ["markdown"],
            },
        },
    },
];

export type ResumeAgentResult = {
    content: string;
    finalScore: number | null;
    scoreTrace: number[];
    searchCalls: number;
    scoreCalls: number;
    rounds: number;
};

export async function runResumeAgent(
    jobId: string,
    userId: string,
    opts: { maxRounds?: number } = {},
): Promise<ResumeAgentResult> {
    const maxRounds = opts.maxRounds ?? 8;
    const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    const target = inferResumeTargetForJob(job);
    const base =
        (await prisma.userResumeBase.findFirst({ where: { userId, target } })) ??
        (await prisma.userResumeBase.findFirst({ where: { userId, isDefault: true } }));
    if (!base) throw new Error("No resume base found for user");

    // The fixed title line + role label from the base — enforced, never upgraded.
    const baseTitleLine =
        base.content.split("\n").map((l) => l.trim()).filter(Boolean).find((l) => l.includes(" | ")) ?? "";
    const baseRoleLabel = baseTitleLine.split("|")[0].trim();

    const system = [
        "You are a resume-tailoring agent. You MUST ground every statement in the candidate's real experience.",
        "Honesty rules (non-negotiable):",
        "- Use ONLY facts present in the base resume or returned by search_experience. Never invent skills, employers, metrics, tools, or achievements.",
        `- The header title line MUST be exactly: "${baseTitleLine}". Do not rewrite it to match the vacancy title.`,
        `- The Summary's first sentence MUST start with the exact role label "${baseRoleLabel}".`,
        "- Do NOT upgrade seniority. Never add 'Senior', 'Lead', 'Principal', or 'Staff' to the title or summary, even if the vacancy title has it, unless the base role label already contains it.",
        "- Do NOT add a technology to Skills or Summary unless it already appears in the base resume.",
        "- If the vacancy needs a skill the candidate lacks, leave it out; never pretend to have it.",
        "Workflow:",
        "1. Call search_experience several times to gather the most relevant real bullets for this vacancy.",
        "2. Draft a tailored resume in markdown, using ONLY facts from the base resume and retrieved experience.",
        "3. Call score_document on your draft, read the issues, and revise to fix STRUCTURAL issues (keywords present in the base but missing from Skills, summary/Skills mismatches). Call score_document again after revising. Stop when the score stops improving or the only remaining gaps are genuinely missing skills.",
        "4. Return ONLY the final resume markdown as your last message (no commentary).",
    ].join("\n");

    const messages: ChatCompletionMessageParam[] = [
        { role: "system", content: system },
        {
            role: "user",
            content: `TARGET VACANCY\nTitle: ${job.title}\nCompany: ${job.company ?? "n/a"}\n\n${job.description.slice(0, 6000)}\n\n=== CANDIDATE BASE RESUME (source of truth) ===\n${base.content}`,
        },
    ];

    let searchCalls = 0;
    let scoreCalls = 0;
    const scoreTrace: number[] = [];

    for (let round = 0; round < maxRounds; round += 1) {
        const resp = await client().chat.completions.create({
            model: MODEL,
            temperature: 0.2,
            messages,
            tools,
            tool_choice: "auto",
        });
        const msg = resp.choices[0].message;
        messages.push(msg);

        if (!msg.tool_calls || msg.tool_calls.length === 0) {
            const content = await enforceNoSeniorityUpgrade(
                (msg.content ?? "").trim(),
                baseRoleLabel,
                messages,
            );
            return {
                content,
                finalScore: scoreTrace.length ? scoreTrace[scoreTrace.length - 1] : null,
                scoreTrace,
                searchCalls,
                scoreCalls,
                rounds: round + 1,
            };
        }

        for (const call of msg.tool_calls) {
            if (call.type !== "function") continue;
            let result: unknown;
            let args: Record<string, unknown> = {};
            try {
                args = JSON.parse(call.function.arguments || "{}");
            } catch {
                args = {};
            }
            if (call.function.name === "search_experience") {
                searchCalls += 1;
                const k = Math.min(Number(args.k) || 6, 10);
                const chunks = await retrieveRelevantChunks(userId, String(args.query ?? ""), k);
                result = chunks.map((c) => ({ source: c.source, text: c.text }));
            } else if (call.function.name === "score_document") {
                scoreCalls += 1;
                const v = validateResumeAgainstJob(job, String(args.markdown ?? ""));
                scoreTrace.push(v.score);
                result = {
                    score: v.score,
                    qualityScore: v.qualityScore,
                    issues: v.issues,
                    missingImportantKeywords: v.missingImportantKeywords,
                };
            } else {
                result = { error: `unknown tool ${call.function.name}` };
            }
            messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
        }
    }

    // Ran out of rounds: force a final answer with no more tools.
    messages.push({ role: "user", content: "Stop using tools. Return ONLY the final resume markdown now." });
    const final = await client().chat.completions.create({ model: MODEL, temperature: 0.2, messages });
    const content = await enforceNoSeniorityUpgrade(
        (final.choices[0].message.content ?? "").trim(),
        baseRoleLabel,
        messages,
    );
    return {
        content,
        finalScore: scoreTrace.length ? scoreTrace[scoreTrace.length - 1] : null,
        scoreTrace,
        searchCalls,
        scoreCalls,
        rounds: maxRounds,
    };
}

const SENIORITY = /\b(senior|lead|principal|staff)\b/i;

/**
 * Deterministic honesty guard: if the base role is not senior but the draft's
 * title line or summary upgraded seniority, run one corrective completion.
 */
async function enforceNoSeniorityUpgrade(
    content: string,
    baseRoleLabel: string,
    messages: ChatCompletionMessageParam[],
): Promise<string> {
    if (SENIORITY.test(baseRoleLabel)) return content; // base is genuinely senior
    const head = content.split("\n").slice(0, 12).join("\n"); // title + summary region
    if (!SENIORITY.test(head)) return content;

    messages.push({
        role: "user",
        content: `You upgraded the seniority. The candidate's real role label is exactly "${baseRoleLabel}". Rewrite the resume removing every "Senior/Lead/Principal/Staff" from the title line and Summary so the title line starts with "${baseRoleLabel}". Return ONLY the corrected resume markdown.`,
    });
    const fix = await client().chat.completions.create({ model: MODEL, temperature: 0.1, messages });
    return (fix.choices[0].message.content ?? content).trim();
}
