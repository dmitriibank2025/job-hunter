import OpenAI from "openai";
import { prisma } from "../infrastructure/prisma";
import {
    assertUserLimit,
    getWorkspaceCandidateProfile,
    recordUsageEvent,
    upsertUserJobMatch,
} from "./user-workspace.service";
import { buildAdaptiveAnalysisPrompt } from "./prompt-learning.service";
import { selectResumeBaseForJob } from "./resume-base-selector.service";
import type { ResumeBaseSelectionMap } from "./resume-base-selector.service";
import { logger } from "../Logger/logger";

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const MODEL = process.env.JOB_ANALYSIS_MODEL ?? "gpt-4.1-mini";
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS ?? 60_000);

// ─── MASTER SKILLS CACHE ──────────────────────────────────────────────────────
// During an automation run, the same user's base resumes are read on every
// analyzeJob call. Cache the extracted skills for 10 minutes so batch runs
// (100+ jobs) only hit the DB once.

const MASTER_SKILLS_TTL_MS = 10 * 60 * 1000; // 10 minutes

type MasterSkillsEntry = { skills: string; expiresAt: number };
const masterSkillsCache = new Map<string, MasterSkillsEntry>();

async function getMasterSkills(userId: string): Promise<string> {
    const now = Date.now();
    const cached = masterSkillsCache.get(userId);
    if (cached && cached.expiresAt > now) return cached.skills;

    const allBases = await prisma.userResumeBase.findMany({
        where: { userId },
        select: { content: true },
        orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
        take: 5,
    });

    const skillLines = new Map<string, string>();
    for (const base of allBases) {
        let inSkills = false;
        for (const line of base.content.split("\n")) {
            const t = line.trim();
            if (t.toUpperCase() === "SKILLS") { inSkills = true; continue; }
            if (inSkills && t && !t.includes(":") && /^[A-Z]/.test(t) && t.length < 30) { inSkills = false; }
            if (inSkills && t.includes(":")) {
                const key = t.split(":")[0].trim().toUpperCase();
                if (key && !skillLines.has(key)) skillLines.set(key, t);
            }
        }
    }

    const skills = skillLines.size > 0 ? Array.from(skillLines.values()).join("\n") : "";
    masterSkillsCache.set(userId, { skills, expiresAt: now + MASTER_SKILLS_TTL_MS });
    return skills;
}

/** Call when base resumes are updated so the cache is immediately invalidated. */
export function invalidateMasterSkillsCache(userId: string): void {
    masterSkillsCache.delete(userId);
}

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
    resumeBaseIds?: ResumeBaseSelectionMap;
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

    const selectedResumeBaseId = options.resumeBaseIds
        ? (await selectResumeBaseForJob(options.userId, job, options.resumeBaseId, options.resumeBaseIds)).id
        : options.resumeBaseId;
    const profile = await getWorkspaceCandidateProfile(options.userId, selectedResumeBaseId);
    if (!profile) throw new Error("Candidate profile not found for this user");

    // Unified skills from all base resumes (cached for 10 min — see getMasterSkills).
    const masterSkills = await getMasterSkills(options.userId);

    // ── Адаптивный промт ────────────────────────────────────────────────────
    const prompt = await buildAdaptiveAnalysisPrompt({
        userId: options.userId,
        fullName: profile.fullName,
        email: profile.email,
        resume: profile.resume,
        masterSkills,
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
