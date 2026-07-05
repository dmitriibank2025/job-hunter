/**
 * prompt-learning.service.ts
 *
 * Самоулучшающийся промт на основе отказов вакансий.
 *
 * Как работает:
 * 1. Пользователь помечает вакансию как REJECTED (через API или UI)
 * 2. recordRejection() сохраняет паттерн отказа в БД
 * 3. buildAdaptiveAnalysisPrompt() читает последние N отказов и встраивает
 *    их в промт анализатора как "anti-patterns"
 * 4. После достаточного числа отказов — generatePromptRefinement() вызывает
 *    GPT для синтеза новых правил и сохраняет их как PromptRule
 * 5. Сохранённые правила применяются ко всем следующим анализам автоматически
 *
 * Схема Prisma (добавить в schema.prisma):
 *
 * model RejectionRecord {
 *   id          String   @id @default(cuid())
 *   userId      String
 *   jobId       String
 *   jobTitle    String
 *   company     String
 *   matchScore  Int
 *   reason      String?          // причина отказа (от работодателя или пользователя)
 *   analysis    Json             // полный анализ GPT в момент подачи
 *   jobSnippet  String           // первые 1000 символов описания вакансии
 *   createdAt   DateTime @default(now())
 *
 *   user        User     @relation(fields: [userId], references: [id])
 *   job         Job      @relation(fields: [jobId], references: [id])
 * }
 *
 * model PromptRule {
 *   id          String   @id @default(cuid())
 *   userId      String
 *   rule        String           // текст правила (1–2 предложения)
 *   category    String           // "skills" | "seniority" | "company_type" | "location" | "general"
 *   confidence  Float            // 0.0–1.0, растёт с числом подтверждений
 *   appliedCount Int  @default(0)
 *   hitCount    Int  @default(0) // сколько раз правило реально помогло избежать отказа
 *   createdAt   DateTime @default(now())
 *   updatedAt   DateTime @updatedAt
 *
 *   user        User     @relation(fields: [userId], references: [id])
 * }
 */

import OpenAI from "openai";
import { PromptRuleCategory, RejectionReasonType } from "@prisma/client";
import { prisma } from "../infrastructure/prisma";
import { logger } from "../Logger/logger";

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const MODEL = process.env.PROMPT_LEARNING_MODEL ?? "gpt-4.1-mini";
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS ?? 60_000);

// Минимум отказов для первой генерации правил
const MIN_REJECTIONS_FOR_REFINEMENT = Number(
    process.env.PROMPT_LEARNING_MIN_REJECTIONS ?? 5,
);

// Максимум отказов передаваемых в промт (чтобы не раздувать контекст)
const MAX_REJECTIONS_IN_PROMPT = Number(
    process.env.PROMPT_LEARNING_MAX_IN_PROMPT ?? 20,
);

// Максимум активных правил в промте
const MAX_RULES_IN_PROMPT = Number(process.env.PROMPT_LEARNING_MAX_RULES ?? 10);

// Порог уверенности для включения правила в промт
const RULE_CONFIDENCE_THRESHOLD = 0.4;

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

export type RejectionReason =
    | "OVERQUALIFIED"
    | "UNDERQUALIFIED"
    | "WRONG_TECH_STACK"
    | "WRONG_SENIORITY"
    | "LOCATION_MISMATCH"
    | "COMPANY_TYPE_MISMATCH"
    | "SALARY_MISMATCH"
    | "NO_RESPONSE"
    | "OTHER";

export type RecordRejectionInput = {
    userId: string;
    jobId: string;
    reason?: RejectionReason | string;
    employerFeedback?: string; // текст письма/сообщения от работодателя
    occurredAt?: Date;
};

type RawRejection = {
    jobTitle: string;
    company: string;
    matchScore: number;
    reason: string | null;
    analysis: any;
    jobSnippet: string;
};

type RawRule = {
    rule: string;
    category: PromptRuleCategory;
    confidence: number;
};

type RejectedResumeReportItem = {
    rejectionId: string;
    jobId: string;
    externalJobId: string | null;
    title: string;
    company: string;
    jobUrl: string | null;
    matchScore: number;
    recommendation: string | null;
    reason: string | null;
    reasonType: RejectionReasonType;
    resumeId: string | null;
    resumeFilePath: string | null;
    resumePdfFilePath: string | null;
    resumeHeadline: string | null;
    matchedSkills: string[];
    missingSkills: string[];
    rejectionRisk: string[];
    createdAt: Date;
};

type RejectedResumeReport = {
    totalRejections: number;
    withResume: number;
    withoutResume: number;
    highScoreRejected: number;
    missingExternalJobIds: number;
    topMissingSkills: Array<{ skill: string; count: number }>;
    topRejectionRisks: Array<{ risk: string; count: number }>;
    items: RejectedResumeReportItem[];
};

// ─── ENUM HELPERS ─────────────────────────────────────────────────────────────

function toRuleCategory(raw?: string): PromptRuleCategory {
    const map: Record<string, PromptRuleCategory> = {
        skills:       PromptRuleCategory.SKILLS,
        seniority:    PromptRuleCategory.SENIORITY,
        company_type: PromptRuleCategory.COMPANY_TYPE,
        location:     PromptRuleCategory.LOCATION,
        general:      PromptRuleCategory.GENERAL,
    };
    return map[(raw ?? "").toLowerCase()] ?? PromptRuleCategory.GENERAL;
}

function toReasonType(raw?: string): RejectionReasonType {
    const valid = Object.values(RejectionReasonType) as string[];
    const upper = (raw ?? "").toUpperCase();
    return valid.includes(upper)
        ? (upper as RejectionReasonType)
        : RejectionReasonType.OTHER;
}

function asStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : [];
}

function countTop(values: string[], limit = 10): Array<{ skill: string; count: number }> {
    const counts = new Map<string, { label: string; count: number }>();

    for (const value of values) {
        const label = value.trim();
        const key = label.toLowerCase();
        const current = counts.get(key);
        counts.set(key, { label: current?.label ?? label, count: (current?.count ?? 0) + 1 });
    }

    return [...counts.values()]
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
        .slice(0, limit)
        .map((item) => ({ skill: item.label, count: item.count }));
}

function resumeHeadline(content?: string | null): string | null {
    if (!content) return null;

    const lines = content
        .split(/\r?\n/)
        .map((line) => line.replace(/^#+\s*/, "").trim())
        .filter(Boolean);

    return lines[1] ?? lines[0] ?? null;
}

function reportAnalysis(recordAnalysis: unknown, matchAnalysis: unknown) {
    const analysis = (matchAnalysis && typeof matchAnalysis === "object" ? matchAnalysis : recordAnalysis) as Record<string, unknown> | null;

    return {
        recommendation: typeof analysis?.recommendation === "string" ? analysis.recommendation : null,
        matchedSkills: asStringArray(analysis?.matchedSkills),
        missingSkills: asStringArray(analysis?.missingSkills),
        rejectionRisk: asStringArray(analysis?.rejectionRisk),
    };
}

// ─── 1. ЗАПИСЬ ОТКАЗА ────────────────────────────────────────────────────────

/**
 * Вызывается когда пользователь получил отказ или пометил вакансию как неудачную.
 * Сохраняет контекст для последующего обучения.
 */
export async function recordRejection(input: RecordRejectionInput): Promise<void> {
    const { userId, jobId, reason, employerFeedback, occurredAt } = input;

    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
        logger.warn({ jobId }, "[PromptLearning] Job not found for rejection record");
        return;
    }

    // Ищем последний анализ этой вакансии для пользователя
    const userMatch = await prisma.userJobMatch.findFirst({
        where: { userId, jobId },
        orderBy: { updatedAt: "desc" },
    });

    const fullReason = [reason, employerFeedback].filter(Boolean).join(" | ") || null;
    const since = occurredAt ? new Date(occurredAt.getTime() - 12 * 60 * 60 * 1000) : undefined;
    const duplicate = await prisma.rejectionRecord.findFirst({
        where: {
            userId,
            jobId,
            reason: fullReason,
            ...(since ? { createdAt: { gte: since } } : {}),
        },
    });

    if (duplicate) {
        logger.debug({ userId, jobId }, "[PromptLearning] Duplicate rejection skipped");
        return;
    }

    await prisma.rejectionRecord.create({
        data: {
            userId,
            jobId,
            jobTitle: job.title,
            company: job.company ?? "Unknown",
            matchScore: userMatch?.matchScore ?? 0,
            reason: fullReason,
            reasonType: toReasonType(reason),
            analysis: (userMatch?.analysis as any) ?? {},
            jobSnippet: job.description.slice(0, 1_000),
            createdAt: occurredAt,
        },
    });

    logger.info(
        { userId, jobId, reason: fullReason },
        "[PromptLearning] Rejection recorded",
    );

    // Если набралось достаточно отказов — автоматически генерируем новые правила
    const rejectionCount = await prisma.rejectionRecord.count({ where: { userId } });

    if (rejectionCount >= MIN_REJECTIONS_FOR_REFINEMENT && rejectionCount % 5 === 0) {
        // Каждые 5 новых отказов — обновляем правила (не блокируем ответ)
        void generatePromptRefinement(userId).catch((err) => {
            logger.error({ err, userId }, "[PromptLearning] Auto-refinement failed");
        });
    }
}

export async function getRejectedResumeReport(userId: string): Promise<RejectedResumeReport> {
    const rejections = await prisma.rejectionRecord.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        include: {
            job: {
                include: {
                    resumeVersions: {
                        where: { userId },
                        orderBy: { createdAt: "desc" },
                        take: 1,
                    },
                    userMatches: {
                        where: { userId },
                        orderBy: { updatedAt: "desc" },
                        take: 1,
                    },
                },
            },
        },
    });

    const items = rejections.map<RejectedResumeReportItem>((rejection) => {
        const resume = rejection.job.resumeVersions[0];
        const match = rejection.job.userMatches[0];
        const analysis = reportAnalysis(rejection.analysis, match?.analysis);

        return {
            rejectionId: rejection.id,
            jobId: rejection.jobId,
            externalJobId: rejection.job.externalJobId,
            title: rejection.jobTitle,
            company: rejection.company,
            jobUrl: rejection.job.url,
            matchScore: match?.matchScore ?? rejection.matchScore,
            recommendation: analysis.recommendation,
            reason: rejection.reason,
            reasonType: rejection.reasonType,
            resumeId: resume?.id ?? null,
            resumeFilePath: resume?.filePath ?? null,
            resumePdfFilePath: resume?.pdfFilePath ?? null,
            resumeHeadline: resumeHeadline(resume?.content),
            matchedSkills: analysis.matchedSkills,
            missingSkills: analysis.missingSkills,
            rejectionRisk: analysis.rejectionRisk,
            createdAt: rejection.createdAt,
        };
    });

    return {
        totalRejections: items.length,
        withResume: items.filter((item) => item.resumeId).length,
        withoutResume: items.filter((item) => !item.resumeId).length,
        highScoreRejected: items.filter((item) => item.matchScore >= 80).length,
        missingExternalJobIds: items.filter((item) => !item.externalJobId).length,
        topMissingSkills: countTop(items.flatMap((item) => item.missingSkills)),
        topRejectionRisks: countTop(items.flatMap((item) => item.rejectionRisk)).map((item) => ({
            risk: item.skill,
            count: item.count,
        })),
        items,
    };
}

// ─── 2. ГЕНЕРАЦИЯ ПРАВИЛ ──────────────────────────────────────────────────────

/**
 * Анализирует паттерны отказов и синтезирует новые правила для промта.
 * Вызывается автоматически или вручную через API.
 */
export async function generatePromptRefinement(userId: string): Promise<RawRule[]> {
    const rejections = await prisma.rejectionRecord.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: MAX_REJECTIONS_IN_PROMPT,
    });

    if (rejections.length < MIN_REJECTIONS_FOR_REFINEMENT) {
        logger.info(
            { userId, count: rejections.length, required: MIN_REJECTIONS_FOR_REFINEMENT },
            "[PromptLearning] Not enough rejections for refinement yet",
        );
        return [];
    }

    const rejectionSummary = rejections.map((r, i) => `
${i + 1}. Job: "${r.jobTitle}" @ ${r.company}
   Score given: ${r.matchScore}/100
   Rejection reason: ${r.reason ?? "No reason provided"}
   GPT recommendation was: ${(r.analysis as any)?.recommendation ?? "unknown"}
   Job snippet: ${r.jobSnippet.slice(0, 400)}
`.trim()).join("\n\n");

    const refinementPrompt = `
You are improving a job-matching AI system. The candidate has received rejections from jobs
that the system recommended. Your task: identify patterns in these rejections and write
concrete rules to make future job analysis more accurate.

════════════════════════════════════════
REJECTION HISTORY (${rejections.length} rejections)
════════════════════════════════════════
${rejectionSummary}

════════════════════════════════════════
YOUR TASK
════════════════════════════════════════
1. Identify 3–7 specific patterns that explain why these applications failed.
2. Write each pattern as a concrete, actionable rule for future analysis.
3. Assign a category and confidence score to each rule.

Rules must be:
- Specific and actionable (not "be careful with seniority" but "reduce score by 20 if job
  requires 7+ years and candidate has fewer than 5 years of relevant experience")
- Based on evidence from the rejection data above
- Written in present tense as instructions

Return ONLY this JSON object:
{
  "rules": [
    {
      "rule": "<specific instruction for the job analyzer>",
      "category": "skills" | "seniority" | "company_type" | "location" | "general",
      "confidence": <0.5–0.9 based on how many rejections support this pattern>
    }
  ]
}

Return only the JSON object, no explanation, no markdown.
`.trim();

    const response = await getOpenAI().chat.completions.create({
        model: MODEL,
        messages: [{ role: "user", content: refinementPrompt }],
        response_format: { type: "json_object" },
    });

    if (response.usage?.total_tokens) {
        logger.info(
            { tokens: response.usage.total_tokens, userId },
            "[PromptLearning] Refinement tokens used",
        );
    }

    let rawRules: RawRule[] = [];

    try {
        const parsed = JSON.parse(response.choices[0]?.message?.content ?? "{}");
        // GPT иногда возвращает { rules: [...] } вместо [...]
        rawRules = Array.isArray(parsed) ? parsed : (parsed.rules ?? []);
    } catch (err) {
        logger.error({ err }, "[PromptLearning] Failed to parse refinement response");
        return [];
    }

    // Сохраняем правила в БД, обновляем уже существующие похожие
    for (const raw of rawRules) {
        if (!raw.rule || typeof raw.rule !== "string") continue;

        const confidence = Math.min(1, Math.max(0, Number(raw.confidence) || 0.5));
        const category = raw.category ?? "general";

        // Ищем похожее правило (первые 80 символов как fingerprint)
        const fingerprint = raw.rule.slice(0, 80);
        const existing = await prisma.promptRule.findFirst({
            where: {
                userId,
                rule: { startsWith: fingerprint },
            },
        });

        if (existing) {
            // Правило уже есть — повышаем уверенность (среднее)
            await prisma.promptRule.update({
                where: { id: existing.id },
                data: {
                    confidence: (existing.confidence + confidence) / 2,
                    rule: raw.rule, // обновляем формулировку
                },
            });
        } else {
            await prisma.promptRule.create({
                data: { userId, rule: raw.rule, category: toRuleCategory(raw.category), confidence },
            });
        }
    }

    logger.info(
        { userId, rulesCount: rawRules.length },
        "[PromptLearning] Prompt rules updated",
    );

    return rawRules;
}

// ─── 3. ЗАГРУЗКА АКТИВНЫХ ПРАВИЛ ─────────────────────────────────────────────

/**
 * Возвращает активные правила пользователя выше порога уверенности,
 * отсортированные по уверенности (самые надёжные — первые).
 */
export async function loadActiveRules(userId: string): Promise<RawRule[]> {
    const rules = await prisma.promptRule.findMany({
        where: {
            userId,
            confidence: { gte: RULE_CONFIDENCE_THRESHOLD },
        },
        orderBy: { confidence: "desc" },
        take: MAX_RULES_IN_PROMPT,
    });

    if (rules.length > 0) {
        await prisma.promptRule.updateMany({
            where: { id: { in: rules.map((rule) => rule.id) } },
            data: { appliedCount: { increment: 1 } },
        });
    }

    return rules.map((r) => ({
        rule: r.rule,
        category: r.category,
        confidence: r.confidence,
    }));
}

// ─── 4. АДАПТИВНЫЙ ПРОМТ АНАЛИЗАТОРА ─────────────────────────────────────────

/**
 * Строит промт для job-analyzer.service.ts с учётом:
 * - базового профиля кандидата
 * - описания вакансии
 * - последних отказов (как anti-patterns)
 * - синтезированных правил (накопленные знания)
 *
 * Использовать ВМЕСТО текущего промта в analyzeJob().
 */
export async function buildAdaptiveAnalysisPrompt(params: {
    userId: string;
    fullName: string;
    email: string;
    resume: string;
    masterSkills?: string;
    jobTitle: string;
    jobCompany: string;
    jobLocation: string;
    jobDescription: string;
}): Promise<string> {
    const {
        userId, fullName, email, resume, masterSkills,
        jobTitle, jobCompany, jobLocation, jobDescription,
    } = params;

    // Загружаем правила и последние отказы параллельно
    const [rules, recentRejections] = await Promise.all([
        loadActiveRules(userId),
        prisma.rejectionRecord.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
            take: 5, // только последние 5 — для примеров в промте
        }),
    ]);

    // ── Секция правил ──────────────────────────────────────────────────────
    const rulesSection = rules.length > 0
        ? `
════════════════════════════════════════
LEARNED RULES FROM PAST REJECTIONS
(Apply these — they are based on ${recentRejections.length}+ real rejections)
════════════════════════════════════════
${rules.map((r, i) =>
            `${i + 1}. [${r.category.toUpperCase()} | confidence: ${Math.round(r.confidence * 100)}%]\n   ${r.rule}`
        ).join("\n\n")}
`
        : "";

    // ── Секция недавних отказов (примеры) ──────────────────────────────────
    const rejectionsSection = recentRejections.length > 0
        ? `
════════════════════════════════════════
RECENT REJECTION EXAMPLES
(Jobs this candidate applied to but was rejected — use as negative reference)
════════════════════════════════════════
${recentRejections.map((r, i) => `
${i + 1}. REJECTED: "${r.jobTitle}" @ ${r.company}
   Our score: ${r.matchScore}/100 | GPT said: ${(r.analysis as any)?.recommendation ?? "?"}
   Employer/candidate feedback: ${r.reason ?? "No feedback recorded"}
   Job snippet: ${r.jobSnippet.slice(0, 300)}
`.trim()).join("\n\n")}

Key insight: If this vacancy looks similar to any of the rejections above,
reduce the match score accordingly and explain why.
`
        : "";

    const masterSkillsSection = masterSkills
        ? `
════════════════════════════════════════
CANDIDATE COMPLETE SKILL SET
(aggregated from all base resumes — use this to avoid penalising skills
 that appear in a different resume variant than the one shown above)
════════════════════════════════════════
${masterSkills}
`
        : "";

    return `
You are an expert technical recruiter analyzing job fit for a candidate.
Your analysis is calibrated by real rejection data from this candidate's history.

════════════════════════════════════════
CANDIDATE PROFILE
════════════════════════════════════════
Name: ${fullName}
Email: ${email}

Resume:
${resume}
${masterSkillsSection}${rulesSection}${rejectionsSection}
════════════════════════════════════════
TARGET VACANCY
════════════════════════════════════════
Title:    ${jobTitle}
Company:  ${jobCompany}
Location: ${jobLocation}

Job Description:
${jobDescription}

════════════════════════════════════════
ANALYSIS INSTRUCTIONS
════════════════════════════════════════
Analyze if the candidate is a good fit. Consider:
1. Technical skills match — skills mentioned in resume vs job requirements
2. Experience level — compare seniority signals in job vs resume
3. Tech stack alignment — key technologies overlap
4. Role type match — full-stack, backend, frontend, etc.
5. Apply the LEARNED RULES above — they reflect real-world rejection patterns
6. Compare to RECENT REJECTION EXAMPLES — avoid repeating the same mistakes

Scoring guide:
- 80–100: Strong match, apply immediately
- 60–79:  Good match, worth applying
- 40–59:  Partial match, apply only if few better options
- 0–39:   Poor match, skip

Critical rejection calibration:
- If a vacancy requires a core technology that is absent from the resume, cap the score at 79 and use MAYBE or SKIP.
- If the role is mobile-specific and requires Flutter, Dart, native Android/iOS, app store release, or mobile CI/CD, and the resume is not mobile-specific, cap the score at 39 and use SKIP.
- If the role requires Vue.js as a primary frontend framework and the resume only shows React, cap the score at 79 unless the job clearly accepts React as an alternative.
- If the role requires 7+ years of frontend-only experience or deep frontend specialization, and the resume is mainly full-stack/backend with about 5+ years total, cap the score at 74.
- If the role requires Go, Java, Spring Boot, Play Framework, Scala, C#, or C++ as primary backend technologies and the resume is mainly Node.js/TypeScript, cap the score at 74 unless the job states these are optional.
- If the role is explicitly AI/LLM/ML product engineering and the resume only mentions AI-assisted developer tools without shipped AI/LLM features, cap the score at 79.
- MANAGEMENT ROLES — cap at 39 and use SKIP if ANY of the following is true:
  • The job title contains "Team Lead", "Tech Lead", "Engineering Manager", "Group Lead", "Squad Lead", "Head of Engineering", "VP Engineering", "Director of Engineering", "Principal Engineer", or "Staff Engineer".
  • The job description states that managing, hiring, or performance-reviewing a team of engineers is a PRIMARY responsibility (not just mentoring or occasional leadership).
  The candidate is an individual contributor with 5+ years and is NOT seeking management or principal-level roles.
- Do not allow a score above 80 when missingSkills contains multiple hard requirements.
- High scores must be reserved for roles where the candidate matches the primary stack, seniority, and role type, not only adjacent transferable experience.

Return ONLY this JSON object, with no markdown and no extra keys:
{
  "matchScore": <0–100>,
  "matchedSkills": [<candidate skills found in job description>],
  "missingSkills": [<important job requirements not in candidate resume>],
  "rejectionRisk": [<specific reasons this application might be rejected, based on learned rules>],
  "recommendation": "APPLY" | "MAYBE" | "SKIP",
  "reason": "<2–3 sentences: score rationale, key strengths, key risks>"
}
`.trim();
}

// ─── 5. ОБРАТНАЯ СВЯЗЬ ПО ПРАВИЛАМ ───────────────────────────────────────────

/**
 * Вызывается когда кандидат получил ПОЛОЖИТЕЛЬНЫЙ ответ — подтверждает правила.
 * Повышает hitCount у правил которые были применены в этом анализе.
 */
export async function recordPositiveOutcome(
    userId: string,
    jobId: string,
): Promise<void> {
    // Находим анализ вакансии
    const match = await prisma.userJobMatch.findFirst({
        where: { userId, jobId },
        orderBy: { updatedAt: "desc" },
    });

    if (!match?.analysis) return;

    // Повышаем уверенность всех правил которые были активны в момент анализа
    // (косвенное подтверждение — анализ с правилами дал APPLY и получил ответ)
    await prisma.promptRule.updateMany({
        where: {
            userId,
            confidence: { gte: RULE_CONFIDENCE_THRESHOLD },
        },
        data: {
            hitCount: { increment: 1 },
            confidence: { increment: 0.02 }, // небольшой буст за подтверждение
        },
    });

    logger.info({ userId, jobId }, "[PromptLearning] Positive outcome recorded, rules boosted");
}

/**
 * Возвращает статистику обучения для пользователя (для UI/API).
 */
export async function getPromptLearningStats(userId: string): Promise<{
    totalRejections: number;
    totalRules: number;
    activeRules: number;
    topRules: RawRule[];
    lastRefinedAt: Date | null;
}> {
    const [totalRejections, allRules] = await Promise.all([
        prisma.rejectionRecord.count({ where: { userId } }),
        prisma.promptRule.findMany({
            where: { userId },
            orderBy: { confidence: "desc" },
        }),
    ]);

    const activeRules = allRules.filter((r) => r.confidence >= RULE_CONFIDENCE_THRESHOLD);
    const lastRule = allRules[0];

    return {
        totalRejections,
        totalRules: allRules.length,
        activeRules: activeRules.length,
        topRules: activeRules.slice(0, 5).map((r) => ({
            rule: r.rule,
            category: r.category,
            confidence: r.confidence,
        })),
        lastRefinedAt: lastRule?.updatedAt ?? null,
    };
}
