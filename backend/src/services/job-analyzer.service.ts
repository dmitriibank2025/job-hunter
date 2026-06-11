import OpenAI from "openai";
import { prisma } from "../infrastructure/prisma";
import {
    assertUserLimit,
    getWorkspaceCandidateProfile,
    recordUsageEvent,
    upsertUserJobMatch,
} from "./user-workspace.service";
import { buildAdaptiveAnalysisPrompt } from "./prompt-learning.service";
import { logger } from "../Logger/logger";

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const MODEL = process.env.JOB_ANALYSIS_MODEL ?? "gpt-4.1-mini";
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS ?? 60_000);

// ─── OPENAI SINGLETON ─────────────────────────────────────────────────────────

let _openai: OpenAI | null = null;

function getOpenAI(): OpenAI {
    if (_openai) return _openai;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey?.startsWith("sk-")) throw new Error("OPENAI_API_KEY missing or invalid");
    _openai = new OpenAI({ apiKey, timeout: OPENAI_TIMEOUT_MS });
    return _openai;
}

// ─── TYPES ────────────────────────────────────────────────────────────────────

type AnalyzeJobOptions = {
    userId?: string;
    resumeBaseId?: string;
};

type JobAnalysis = {
    matchScore: number;
    matchedSkills: string[];
    missingSkills: string[];
    rejectionRisk: string[];    // ← новое поле из адаптивного промта
    recommendation: "APPLY" | "MAYBE" | "SKIP";
    reason: string;
};

// ─── GUARD ────────────────────────────────────────────────────────────────────

function parseAnalysis(raw: string | null | undefined): JobAnalysis {
    const fallback: JobAnalysis = {
        matchScore: 50,
        matchedSkills: [],
        missingSkills: [],
        rejectionRisk: [],
        recommendation: "MAYBE",
        reason: "Analysis parsing failed — defaulting to MAYBE",
    };

    if (!raw) return fallback;

    try {
        const parsed = JSON.parse(raw);

        const matchScore = Number.isFinite(Number(parsed.matchScore))
            ? Math.max(0, Math.min(100, Math.round(Number(parsed.matchScore))))
            : 50;

        return {
            matchScore,
            matchedSkills: Array.isArray(parsed.matchedSkills) ? parsed.matchedSkills : [],
            missingSkills: Array.isArray(parsed.missingSkills) ? parsed.missingSkills : [],
            rejectionRisk: Array.isArray(parsed.rejectionRisk) ? parsed.rejectionRisk : [],
            recommendation: ["APPLY", "MAYBE", "SKIP"].includes(parsed.recommendation)
                ? parsed.recommendation
                : "MAYBE",
            reason: typeof parsed.reason === "string" ? parsed.reason : "",
        };
    } catch (err) {
        logger.error({ err }, "[JobAnalyzer] Failed to parse analysis response");
        return fallback;
    }
}

// ─── CORE ─────────────────────────────────────────────────────────────────────

export async function analyzeJob(jobId: string, options: AnalyzeJobOptions = {}) {
    if (!options.userId) {
        throw new Error("userId is required for job analysis");
    }

    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new Error(`Job not found: ${jobId}`);

    await assertUserLimit(options.userId, "OPENAI_TOKENS");

    const profile = await getWorkspaceCandidateProfile(options.userId, options.resumeBaseId);
    if (!profile) throw new Error("Candidate profile not found for this user");

    // ── Адаптивный промт ────────────────────────────────────────────────────
    // Строится с учётом накопленных правил и истории отказов.
    // При первых запусках (нет отказов) ведёт себя как обычный промт.
    const prompt = await buildAdaptiveAnalysisPrompt({
        userId: options.userId,
        fullName: profile.fullName,
        email: profile.email,
        resume: profile.resume,
        jobTitle: job.title,
        jobCompany: job.company ?? "Unknown",
        jobLocation: job.location ?? "Unknown",
        jobDescription: job.description,
    });

    const response = await getOpenAI().chat.completions.create({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
    });

    if (response.usage?.total_tokens) {
        await recordUsageEvent(options.userId, "OPENAI_TOKENS", response.usage.total_tokens, {
            scope: "job_analysis",
            jobId,
            model: MODEL,
        });
    }

    const analysis = parseAnalysis(response.choices[0]?.message?.content);

    logger.info(
        {
            jobId,
            userId: options.userId,
            score: analysis.matchScore,
            recommendation: analysis.recommendation,
            rejectionRisks: analysis.rejectionRisk.length,
        },
        "[JobAnalyzer] Analysis complete",
    );

    await prisma.job.update({
        where: { id: job.id },
        data: { status: "ANALYZED" },
    });

    const userMatch = await upsertUserJobMatch(options.userId, job.id, {
        status: "ANALYZED",
        matchScore: analysis.matchScore,
        analysis,
    });

    return {
        ...job,
        status: "ANALYZED" as const,
        matchScore: analysis.matchScore,
        analysis,
        userMatch,
    };
}