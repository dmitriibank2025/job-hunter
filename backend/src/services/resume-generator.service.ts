import OpenAI from "openai";
import { Job } from "@prisma/client";
import fs from "fs/promises";
import path from "path";
import {
    ensureDir,
    getStorageRoot,
    saveTextFile,
    slugify,
} from "./file-storage.service";
import { convertDocxToPdf, createCoverLetterDocx, createResumeDocx, createResumeDocxFromTemplate } from "./docx.service";
import { createBasicResumePdf } from "./resume-pdf.service";
import {
    assertUserLimit,
    getWorkspaceCandidateProfile,
    recordUsageEvent,
} from "./user-workspace.service";
import { selectResumeBaseForJob } from "./resume-base-selector.service";
import type { ResumeBaseSelectionMap } from "./resume-base-selector.service";
import {
    removeUnsupportedTechnologiesFromExperience,
    validateResumeAgainstJob,
} from "./ats-resume-validator.service";
import { logger } from "../Logger/logger";
import { prisma } from "../infrastructure/prisma";

const MODEL = process.env.RESUME_GENERATION_MODEL ?? "gpt-4.1-mini";
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS ?? 60_000);
const MIN_DESCRIPTION_LENGTH = Number(process.env.MIN_JOB_DESCRIPTION_LENGTH ?? 500);
const ATS_RESUME_MIN_SCORE = Number(process.env.ATS_RESUME_MIN_SCORE ?? 75);
const ATS_RESUME_ENFORCE = process.env.ATS_RESUME_ENFORCE === "true";
const ATS_RESUME_REPAIR_ATTEMPTS = Math.max(0, Number(process.env.ATS_RESUME_REPAIR_ATTEMPTS ?? 2));

const JOB_KEYWORD_ALIASES = [
    "TypeScript", "JavaScript", "HTML", "CSS", "React", "React.js", "Next.js",
    "Vue", "Angular", "Redux", "Redux Toolkit", "Zustand", "React Query",
    "TanStack Query", "Material UI", "MUI", "Tailwind", "Bootstrap",
    "Frontend Architecture", "Front End Infrastructure", "Frontend Infrastructure",
    "Design Systems", "Component Library", "Reusable Components", "Storybook",
    "Micro Frontends", "Module Federation", "Webpack", "Vite", "Code Splitting",
    "Lazy Loading", "Bundle Optimization", "Performance Optimization",
    "Performance Profiling", "Web Vitals", "Accessibility", "Responsive UI", "UX", "UI",
    "Node.js", "Express", "Express.js", "NestJS", "REST", "REST API", "GraphQL",
    "JWT", "OAuth", "RBAC", "Zod", "Swagger", "OpenAPI",
    "PostgreSQL", "MySQL", "MongoDB", "Redis", "DynamoDB", "Prisma", "Mongoose", "SQL", "NoSQL",
    "AWS", "Lambda", "SQS", "SNS", "Fargate", "Docker", "Kubernetes", "CI/CD", "GitHub Actions",
    "Cloud", "Serverless", "SaaS", "Enterprise SaaS", "Multi-tenant", "Multi Tenant",
    "Distributed Systems", "Microservices", "Scalability", "Reliability", "High Reliability",
    "Automation", "System Design", "Performance", "Monitoring", "Logging", "Production Support",
    "Incident Response", "Agile", "Jest", "Testing Library", "Playwright", "Cypress",
    "Unit Testing", "E2E Testing", "Python", "Java", "Go", "PHP", "Laravel", "Ruby", "Rails",
    "AI", "LLM", "Cyber Security", "Cybersecurity",
] as const;

const REQUIREMENT_CATEGORY_HINTS = {
    technical: ["React", "TypeScript", "JavaScript", "Node.js", "HTML", "CSS", "REST", "API", "AWS", "Docker", "Testing"],
    architecture: ["architecture", "infrastructure", "distributed", "scalable", "scale", "multi-tenant", "enterprise", "platform", "performance", "reliability"],
    product: ["UX", "user experience", "stakeholders", "requirements", "priorities", "product", "customer", "business"],
    seniority: ["own", "ownership", "lead", "design", "research", "suggest", "responsibility", "senior"],
} as const;

const ROLE_KEYWORD_PRIORITIES = {
    frontend: ["TypeScript", "JavaScript", "React", "React.js", "Angular", "Vue", "Next.js", "HTML", "CSS", "Redux", "UX", "UI", "Accessibility", "Performance Optimization"],
    backend: ["Node.js", "TypeScript", "JavaScript", "REST", "REST API", "GraphQL", "PostgreSQL", "MongoDB", "Redis", "DynamoDB", "AWS", "Docker", "Microservices", "Distributed Systems", "Scalability", "Reliability"],
    fullstack: ["TypeScript", "JavaScript", "React", "React.js", "Node.js", "REST", "REST API", "PostgreSQL", "MongoDB", "AWS", "Docker", "SaaS"],
    platform: ["AWS", "Docker", "Kubernetes", "CI/CD", "Cloud", "Serverless", "Distributed Systems", "Reliability", "Monitoring", "Logging", "Python"],
    data: ["Python", "SQL", "PostgreSQL", "AWS", "DynamoDB", "Analytics", "AI", "LLM", "Distributed Systems"],
    security: ["Cyber Security", "Cybersecurity", "Security", "AWS", "OAuth", "JWT", "RBAC", "Reliability"],
    qa: ["Playwright", "Cypress", "Jest", "Testing Library", "E2E Testing", "Unit Testing", "Automation", "CI/CD"],
    general: ["TypeScript", "JavaScript", "Node.js", "React", "AWS", "Docker", "PostgreSQL", "REST", "Distributed Systems"],
} as const;

const RESUME_CODE_MAP: Array<{ pattern: RegExp; code: string }> = [
    { pattern: /(frontend|front-end)/i, code: "FEND" },
    { pattern: /(backend|back-end)/i, code: "BEND" },
    { pattern: /(full[\s-]?stack|fullstack)/i, code: "FSWD" },
    { pattern: /(devops|platform|cloud|infra)/i, code: "CLOD" },
    { pattern: /(data|analytics|bi|machine\s?learn)/i, code: "DATA" },
    { pattern: /(mobile|ios|android)/i, code: "MOBI" },
    { pattern: /(qa|quality|test\s?engineer)/i, code: "QENG" },
    { pattern: /(security|devsec|cyber)/i, code: "SECU" },
];

let _openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
    if (_openai) return _openai;

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey?.startsWith("sk-")) {
        throw new Error("OPENAI_API_KEY is missing or invalid");
    }

    _openai = new OpenAI({ apiKey, timeout: OPENAI_TIMEOUT_MS });
    return _openai;
}

type GenerationOptions = {
    userId?: string;
    resumeBaseId?: string;
    resumeBaseIds?: ResumeBaseSelectionMap;
};

type PackageResult = {
    resume: Awaited<ReturnType<typeof generateResumeForJob>>;
    coverLetter: Awaited<ReturnType<typeof generateCoverLetterForJob>>;
};

type FinalizedResumeContent = {
    content: string;
    atsScore: number;
    atsIssues: string[];
    atsMatchedKeywords: string[];
    atsMissingKeywords: string[];
    atsValidatedAt: Date;
};

type RequirementAnalysis = {
    detectedKeywords: string[];
    technicalRequirements: string[];
    architectureRequirements: string[];
    productRequirements: string[];
    seniorityRequirements: string[];
    rankedRequirements: string[];
    roleFocus: string;
};

type ResumeTailoringAnalysis = {
    matchScore?: number;
    matchedSkills: string[];
    missingSkills: string[];
    rejectionRisk: string[];
    recommendation?: string;
    reason?: string;
};

function asStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : [];
}

function parseTailoringAnalysis(raw: unknown): ResumeTailoringAnalysis | null {
    if (!raw || typeof raw !== "object") return null;

    const value = raw as Record<string, unknown>;
    const matchScore = Number(value.matchScore);

    return {
        matchScore: Number.isFinite(matchScore) ? Math.max(0, Math.min(100, Math.round(matchScore))) : undefined,
        matchedSkills: asStringArray(value.matchedSkills),
        missingSkills: asStringArray(value.missingSkills),
        rejectionRisk: asStringArray(value.rejectionRisk),
        recommendation: typeof value.recommendation === "string" ? value.recommendation : undefined,
        reason: typeof value.reason === "string" ? value.reason : undefined,
    };
}

function hasRealDescription(description: string): boolean {
    return description.replace(/\s+/g, " ").trim().length >= MIN_DESCRIPTION_LENGTH;
}

function cleanAiText(value: string): string {
    return value
        .replace(/^```(?:markdown|md|text)?\s*/i, "")
        .replace(/```$/i, "")
        .replace(/\r\n/g, "\n")
        .trim();
}

function normalizeSectionText(value: string): string {
    return value
        .replace(/\n{3,}/g, "\n\n")
        .split("\n")
        .map((line) => line.replace(/\s+$/g, ""))
        .join("\n")
        .trim();
}

function sanitizeFileNamePart(value: string): string {
    return value.normalize("NFKD").replace(/[^\w\s-]/g, "").trim() || "Candidate";
}

function buildResumeCode(title: string): string {
    for (const { pattern, code } of RESUME_CODE_MAP) {
        if (pattern.test(title)) return code;
    }

    logger.warn({ title }, "[generation] Unknown role title; using BASE resume code");
    return "BASE";
}

function buildCandidateResumeBaseName(fullName: string, resumeCode: string): string {
    const compactName = sanitizeFileNamePart(fullName)
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 3)
        .join("_");

    return `CV_${compactName}_${resumeCode}`;
}

function resolveStoragePath(relativeOrAbsolutePath?: string | null): string | null {
    if (!relativeOrAbsolutePath) return null;
    return path.isAbsolute(relativeOrAbsolutePath)
        ? relativeOrAbsolutePath
        : path.join(getStorageRoot(), relativeOrAbsolutePath);
}

async function createResumeDocxPreservingTemplate(input: {
    content: string;
    baseContent: string;
    sourceFilePath?: string | null;
    outputPath: string;
}) {
    const templatePath = resolveStoragePath(input.sourceFilePath);
    if (templatePath && /\.docx$/i.test(templatePath)) {
        const saved = await createResumeDocxFromTemplate({
            templatePath,
            baseContent: input.baseContent,
            generatedContent: input.content,
            outputPath: input.outputPath,
        });
        if (saved) return;
    }

    await createResumeDocx(input.content, input.outputPath);
}

async function createResumePdfFromDocx(input: {
    content: string;
    docxPath: string;
    pdfPath: string;
    jobId: string;
    userId: string;
    company?: string | null;
    title: string;
    logMessage: string;
}): Promise<string | null> {
    try {
        return await convertDocxToPdf({
            docxPath: input.docxPath,
            outputPath: input.pdfPath,
        });
    } catch (conversionError: unknown) {
        logger.error(
            {
                error: conversionError,
                jobId: input.jobId,
                userId: input.userId,
                company: input.company,
                title: input.title,
            },
            "[generation] DOCX to PDF conversion failed; falling back to basic PDF",
        );
    }

    return createBasicResumePdf(input.content, input.pdfPath, "ATS").catch((error: unknown) => {
        logger.error(
            {
                error,
                jobId: input.jobId,
                userId: input.userId,
                company: input.company,
                title: input.title,
            },
            input.logMessage,
        );
        return null;
    });
}

function escapeRegex(value: string): string {
    return value.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsPhrase(text: string, phrase: string): boolean {
    const escaped = escapeRegex(phrase);
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i").test(text);
}

function canonicalKeyword(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function extractAllowedTechnologies(baseResume: string): string[] {
    const seen = new Set<string>();

    return JOB_KEYWORD_ALIASES.filter((keyword) => {
        const canonical = canonicalKeyword(keyword);
        if (seen.has(canonical) || !containsPhrase(baseResume, keyword)) return false;
        seen.add(canonical);
        return true;
    });
}

function technologyItemHasKnownAlias(item: string): boolean {
    return JOB_KEYWORD_ALIASES.some((keyword) => containsPhrase(item, keyword));
}

function isAllowedTechnologyItem(item: string, allowedTechnologies: readonly string[]): boolean {
    const knownAliases = JOB_KEYWORD_ALIASES.filter((keyword) => containsPhrase(item, keyword));
    if (knownAliases.length === 0) return true;

    return knownAliases.some((keyword) =>
        allowedTechnologies.some((allowed) => canonicalKeyword(allowed) === canonicalKeyword(keyword)),
    );
}

function filterAllowedTechnologyList(value: string, allowedTechnologies: readonly string[]): string {
    return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item) => isAllowedTechnologyItem(item, allowedTechnologies))
        .join(", ");
}

function isHeaderContactOrMetadataLine(line: string): boolean {
    return isHeaderContactLine(line) || /^#+\s+/.test(line.trim()) || /^##\s+/.test(line.trim());
}

function extractBaseHeaderTargetLine(baseResume: string): string {
    const lines = normalizeSectionText(baseResume).split("\n");
    const titleIndex = lines.findIndex((line) => /^#\s+/.test(line.trim()));
    if (titleIndex < 0) {
        const plainLines = lines.map((line) => line.trim()).filter(Boolean);
        const targetLine = plainLines.find((line, index) =>
            index > 0 && !isHeaderContactOrMetadataLine(line),
        );
        return targetLine ?? "Software Developer";
    }

    const start = titleIndex >= 0 ? titleIndex + 1 : 0;
    const targetLine = lines
        .slice(start, start + 8)
        .map((line) => line.trim())
        .find((line) => line && !isHeaderContactOrMetadataLine(line));

    return targetLine ?? "Software Developer";
}

function sanitizeHeaderTargetLine(targetLine: string, allowedTechnologies: readonly string[]): string {
    const [rolePart, ...technologyParts] = targetLine
        .split("|")
        .map((part) => part.trim())
        .filter(Boolean);

    const allowedTechnologyParts = technologyParts
        .filter((part) => technologyItemHasKnownAlias(part))
        .filter((part) => isAllowedTechnologyItem(part, allowedTechnologies));

    return [rolePart || "Software Developer", ...allowedTechnologyParts].join(" | ");
}

function headerRolePart(targetLine: string): string {
    return targetLine.split("|")[0]?.trim() || "Software Developer";
}

function extractJobKeywords(description: string): string[] {
    const seen = new Set<string>();

    return JOB_KEYWORD_ALIASES.filter((keyword) => {
        const matched = containsPhrase(description, keyword);

        if (!matched || seen.has(keyword.toLowerCase())) return false;
        seen.add(keyword.toLowerCase());
        return true;
    });
}

function extractRequirementLines(description: string, hints: readonly string[], max = 8): string[] {
    const lines = description
        .split(/\n|•|- |\* /)
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter((line) => line.length >= 25 && line.length <= 220);

    const scored = lines
        .map((line) => {
            const lower = line.toLowerCase();
            const score = hints.reduce(
                (sum, hint) => sum + (lower.includes(hint.toLowerCase()) ? 1 : 0),
                0,
            );

            return { line, score };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((item) => item.line);

    return Array.from(new Set(scored)).slice(0, max);
}

function inferRoleFocus(job: Job): string {
    const titleAndDescription = `${job.title}\n${job.description}`.toLowerCase();

    if (/frontend|front-end|react|ui|ux/.test(titleAndDescription)) {
        return "Frontend / React / SaaS UI";
    }

    if (/backend|back-end|node|api|server/.test(titleAndDescription)) {
        return "Backend / APIs / Server-side Engineering";
    }

    if (/full[\s-]?stack|fullstack/.test(titleAndDescription)) {
        return "Full Stack / Product Engineering";
    }

    if (/platform|cloud|devops|infra/.test(titleAndDescription)) {
        return "Platform / Cloud / Infrastructure";
    }

    if (/security|cyber/.test(titleAndDescription)) {
        return "Security / Cybersecurity Product Engineering";
    }

    return "Software Engineering";
}

function analyzeJobRequirements(job: Job): RequirementAnalysis {
    const description = job.description;
    const detectedKeywords = extractJobKeywords(description);

    const technicalRequirements = extractRequirementLines(description, REQUIREMENT_CATEGORY_HINTS.technical);
    const architectureRequirements = extractRequirementLines(description, REQUIREMENT_CATEGORY_HINTS.architecture);
    const productRequirements = extractRequirementLines(description, REQUIREMENT_CATEGORY_HINTS.product);
    const seniorityRequirements = extractRequirementLines(description, REQUIREMENT_CATEGORY_HINTS.seniority);

    const rankedRequirements = Array.from(
        new Set([
            ...architectureRequirements,
            ...technicalRequirements,
            ...seniorityRequirements,
            ...productRequirements,
        ]),
    ).slice(0, 15);

    return {
        detectedKeywords,
        technicalRequirements,
        architectureRequirements,
        productRequirements,
        seniorityRequirements,
        rankedRequirements,
        roleFocus: inferRoleFocus(job),
    };
}

function listOrFallback(values: string[], fallback: string): string {
    return values.length ? values.map((v) => `- ${v}`).join("\n") : `- ${fallback}`;
}

function buildJobSummary(job: Job): string {
    return [
        `Title:    ${job.title}`,
        `Company:  ${job.company ?? "Unknown"}`,
        `Location: ${job.location ?? "Unknown"}`,
        "",
        "Full job description:",
        "---",
        job.description,
        "---",
    ].join("\n");
}

function buildRequirementAnalysisBlock(job: Job): string {
    const analysis = analyzeJobRequirements(job);

    return `
ROLE FOCUS:
${analysis.roleFocus}

DETECTED JOB KEYWORDS:
${analysis.detectedKeywords.length ? analysis.detectedKeywords.join(", ") : "No explicit technology keywords detected"}

TOP RANKED REQUIREMENTS:
${listOrFallback(analysis.rankedRequirements, "No ranked requirements detected automatically. Use the full job description.")}

TECHNICAL REQUIREMENTS:
${listOrFallback(analysis.technicalRequirements, "No explicit technical requirements detected automatically.")}

ARCHITECTURE / SCALE REQUIREMENTS:
${listOrFallback(analysis.architectureRequirements, "No explicit architecture or scale requirements detected automatically.")}

PRODUCT / COLLABORATION REQUIREMENTS:
${listOrFallback(analysis.productRequirements, "No explicit product or collaboration requirements detected automatically.")}

SENIORITY / OWNERSHIP SIGNALS:
${listOrFallback(analysis.seniorityRequirements, "No explicit seniority or ownership signals detected automatically.")}
`.trim();
}

function inferRoleKeywordPriority(job: Job): readonly string[] {
    const title = job.title.toLowerCase();
    const description = job.description.toLowerCase();

    for (const text of [title, description]) {
        if (/full[\s-]?stack|fullstack/.test(text)) return ROLE_KEYWORD_PRIORITIES.fullstack;
        if (/security|cyber/.test(text)) return ROLE_KEYWORD_PRIORITIES.security;
        if (/qa|quality|test|automation/.test(text)) return ROLE_KEYWORD_PRIORITIES.qa;
        if (/data|analytics|bi|machine\s?learn|ai|llm/.test(text)) return ROLE_KEYWORD_PRIORITIES.data;
        if (/backend|back-end|node|api|server/.test(text)) return ROLE_KEYWORD_PRIORITIES.backend;
        if (/frontend|front-end|angular|react|ui|ux/.test(text)) return ROLE_KEYWORD_PRIORITIES.frontend;
        if (/platform|cloud|devops|infra|sre|ci\/cd/.test(text)) return ROLE_KEYWORD_PRIORITIES.platform;
    }

    return ROLE_KEYWORD_PRIORITIES.general;
}

function rankKeywordsForRole(job: Job, keywords: string[]): string[] {
    const priority = inferRoleKeywordPriority(job);
    const priorityIndex = new Map(priority.map((keyword, index) => [keyword.toLowerCase(), index]));

    return [...keywords].sort((a, b) => {
        const aIndex = priorityIndex.get(a.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
        const bIndex = priorityIndex.get(b.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;

        if (aIndex !== bIndex) return aIndex - bIndex;
        return a.localeCompare(b);
    });
}

function buildSkillsSectionGuidance(job: Job): string {
    const priority = inferRoleKeywordPriority(job);

    if (priority === ROLE_KEYWORD_PRIORITIES.fullstack) {
        return `
Use these Skills categories for full-stack roles:
Languages:
Frontend:
Backend:
Product & SaaS:
Cloud & Async:
Databases & Cache:
Security & Reliability:
Infrastructure & Testing:
Tools:
AI-Assisted Development:

For full-stack roles, Frontend and Backend are both required when supported by the source resume.
Frontend must include supported UI technologies relevant to the vacancy, such as React, Angular, Vue,
TypeScript, JavaScript, HTML, CSS, Redux, responsive UI, API integration, or design-system work.
Backend must include supported server-side technologies such as Node.js, Express.js, NestJS, REST APIs,
auth, validation, microservices, and related backend architecture.
Product & SaaS must include supported product-led, SaaS, ownership, collaboration, API integration,
customer-facing product, or business-impact experience when mentioned in the summary.
`.trim();
    }

    if (priority === ROLE_KEYWORD_PRIORITIES.frontend) {
        return `
Use these Skills categories for frontend roles:
Languages:
Frontend:
State, UI & Product:
API Integration:
Testing:
Tools:
AI-Assisted Development:

Frontend must be the strongest section and include supported React/Angular/Vue, TypeScript,
JavaScript, HTML, CSS, state management, responsive UI, accessibility, performance, UX, or design-system work.
Include backend/cloud skills only if they strengthen this frontend vacancy and are supported by the source resume.
`.trim();
    }

    if (priority === ROLE_KEYWORD_PRIORITIES.backend) {
        return `
Use these Skills categories for backend roles:
Languages:
Backend:
Cloud & Async:
Databases & Cache:
Security & Reliability:
Infrastructure & Testing:
Tools:
AI-Assisted Development:

Backend must be the strongest section. Include frontend skills only when the vacancy is explicitly full-stack
or when they are useful context and supported by the source resume.
`.trim();
    }

    if (priority === ROLE_KEYWORD_PRIORITIES.platform) {
        return `
Use these Skills categories for platform/cloud/infrastructure roles:
Languages:
Cloud & Infrastructure:
Backend & Automation:
Databases & Messaging:
Reliability & Observability:
Testing & CI/CD:
Tools:
AI-Assisted Development:
`.trim();
    }

    if (priority === ROLE_KEYWORD_PRIORITIES.data) {
        return `
Use these Skills categories for data/AI roles:
Languages:
Data & Analytics:
Backend & APIs:
Cloud & Infrastructure:
Databases:
Testing & Reliability:
Tools:
AI-Assisted Development:
`.trim();
    }

    if (priority === ROLE_KEYWORD_PRIORITIES.security) {
        return `
Use these Skills categories for security roles:
Languages:
Security Engineering:
Backend & APIs:
Cloud & Infrastructure:
Reliability:
Testing:
Tools:
AI-Assisted Development:
`.trim();
    }

    if (priority === ROLE_KEYWORD_PRIORITIES.qa) {
        return `
Use these Skills categories for QA/automation roles:
Languages:
Test Automation:
Frontend & API Testing:
CI/CD & Infrastructure:
Backend Context:
Tools:
AI-Assisted Development:
`.trim();
    }

    return `
Use role-relevant Skills categories. The first categories must match the vacancy direction.
Include only skills present in the source resume.
`.trim();
}

function buildTargetTitleGuidance(job: Job): string {
    const targetTitle = buildTargetRoleLabel(job);
    const keywords = rankKeywordsForRole(
        job,
        extractJobKeywords(`${job.title}\n${job.description}`),
    ).slice(0, 4);
    const titleParts = [
        targetTitle,
        ...keywords,
    ].filter(Boolean);

    return Array.from(new Set(titleParts)).slice(0, 5).join(" | ");
}

function buildTargetRoleLabel(job: Job): string {
    const normalized = job.title
        .replace(/\s+/g, " ")
        .replace(/[–—]/g, "-")
        .trim();

    const withoutPipe = normalized.split(/\s+\|\s+/)[0] ?? normalized;
    const withoutCompany = withoutPipe.replace(/\s+at\s+.+$/i, "");
    const withoutParentheticalNoise = withoutCompany
        .replace(/\s*\((?:\d+|remote|hybrid|onsite|full[-\s]?time|part[-\s]?time|contract|israel|tel aviv|haifa|jerusalem|job id|req)[^)]*\)\s*/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
    const [withoutNoiseSuffix] = withoutParentheticalNoise.split(/(?:\s+-\s*|\s*-\s+)/);
    const compact = withoutNoiseSuffix.trim();

    return compact.length > 72 ? `${compact.slice(0, 72).trim()}...` : compact;
}

function formatAnalysisForPrompt(analysis: ResumeTailoringAnalysis | null): string {
    if (!analysis) {
        return "No previous job analysis is available. Perform the fit analysis from the resume and vacancy only.";
    }

    const lines = [
        `Match score: ${analysis.matchScore ?? "unknown"}/100`,
        `Recommendation: ${analysis.recommendation ?? "unknown"}`,
        "",
        "Matched skills to emphasize truthfully:",
        listOrFallback(analysis.matchedSkills, "No matched skills from previous analysis."),
        "",
        "Missing / weak requirements that must NOT be invented:",
        listOrFallback(analysis.missingSkills, "No missing requirements from previous analysis."),
        "",
        "Rejection risks to reduce where truthfully possible:",
        listOrFallback(analysis.rejectionRisk, "No rejection risks from previous analysis."),
    ];

    if (analysis.reason) {
        lines.push("", `Analysis rationale: ${analysis.reason}`);
    }

    return lines.join("\n");
}

async function loadLatestTailoringAnalysis(
    userId: string,
    jobId: string,
): Promise<ResumeTailoringAnalysis | null> {
    const match = await prisma.userJobMatch.findFirst({
        where: { userId, jobId },
        orderBy: { updatedAt: "desc" },
        select: { analysis: true, matchScore: true },
    });

    const parsed = parseTailoringAnalysis(match?.analysis);
    if (!parsed) return null;

    return {
        ...parsed,
        matchScore: parsed.matchScore ?? match?.matchScore ?? undefined,
    };
}

export function buildResumePrompt(
    job: Job,
    baseResume: string,
    tailoringAnalysis: ResumeTailoringAnalysis | null = null,
): string {
    const allowedTechnologies = extractAllowedTechnologies(baseResume);
    const fixedHeaderTargetLine = sanitizeHeaderTargetLine(
        extractBaseHeaderTargetLine(baseResume),
        allowedTechnologies,
    );
    const fixedRoleLabel = headerRolePart(fixedHeaderTargetLine);

    return `
You are an expert technical resume strategist for software engineering roles.
Your task is to tailor the candidate's existing resume to the target vacancy.

You must optimize the resume for:
1. ATS keyword matching
2. Hiring manager relevance
3. Technical credibility
4. Role-specific positioning
5. Truthfulness

════════════════════════════════════════
CANDIDATE SOURCE RESUME
════════════════════════════════════════
${baseResume}

════════════════════════════════════════
TARGET VACANCY
════════════════════════════════════════
${buildJobSummary(job)}

════════════════════════════════════════
AUTOMATIC JOB REQUIREMENT ANALYSIS
════════════════════════════════════════
${buildRequirementAnalysisBlock(job)}

════════════════════════════════════════
PREVIOUS JOB FIT ANALYSIS
════════════════════════════════════════
${formatAnalysisForPrompt(tailoringAnalysis)}

════════════════════════════════════════
STRICT TRUTHFULNESS RULES
════════════════════════════════════════
- Use ONLY facts present in the candidate source resume.
- Treat the candidate source resume as the source of truth for visual structure and style.
- Preserve the base resume's look and feel: section order, heading style, markdown density,
  bullet style, contact layout, experience formatting, and overall template.
- Do NOT rewrite the resume into a different template.
- Edit only these content areas:
  1. Summary paragraph text.
  2. Existing Experience bullet text.
  3. Ordering of items WITHIN existing Skills category lines (reorder comma-separated items by relevance; do not add or remove items).
- Do NOT rename, add, or remove Skills categories or Skills category lines.
- Do NOT edit Experience role headers, project lines, Technologies lines, Education, contact lines, languages, or section headings.
- Do NOT add or remove experience roles.
- Do NOT add or remove sections.
- Do NOT add new sections that are absent from the base resume unless the section already exists
  in the agreed base format and contains source-supported content.
- Do NOT invent tools, technologies, employers, responsibilities, metrics,
  project names, certificates, degrees, languages, awards, or seniority levels.
- Do NOT add skills that are not present in the source resume.
- Technologies are strictly allowlisted. You may mention a technology only if it appears in this list:
  ${allowedTechnologies.length ? allowedTechnologies.join(", ") : "No explicit technologies detected in the source resume."}
- Do NOT add job technologies that are absent from the allowlist, even if they are important ATS keywords.
- If a job keyword is not in the allowlist, omit it and use adjacent truthful wording without naming that technology.
- If the job requires a missing skill, do NOT pretend the candidate has it.
- Emphasize the closest real experience only when it is genuinely supported
  by the source resume.
- Copy all dates EXACTLY as written.
- Copy contact information EXACTLY as written.
- Do not modify email, phone, LinkedIn, GitHub, location, or employer names.
- Do not change the header title/role. The header target line's role part is fixed.
- You may only adjust technologies after "|" in the header target line, and only from the allowlist above.
- Do not upgrade titles. Example: do not turn "Developer" into "Senior Developer"
  unless the source resume already says so.

════════════════════════════════════════
TAILORING STRATEGY
════════════════════════════════════════
Before writing the final resume, internally build a resume strategy. Do not output it.

Internal strategy must identify:
1. Top hiring signals from the vacancy.
2. Top rejection signals from the vacancy and previous fit analysis.
3. Strong matches already supported by the source resume.
4. Partial matches / transferable experience supported by the source resume.
5. Missing requirements that must stay absent or be handled honestly.
6. Sections and bullets to promote, shorten, or remove.

Then write the final resume.

Use these rules:
- Prioritize the most relevant experience and skills for this exact vacancy.
- Reorder bullet points by relevance, not by generic importance.
- Use terminology from the vacancy only when supported by the source resume.
- Place exact matched skills from PREVIOUS JOB FIT ANALYSIS visibly in Skills and Experience.
- Never add missing skills from PREVIOUS JOB FIT ANALYSIS unless they appear in the source resume.
- Reduce rejection risks by clarifying real adjacent experience, not by inventing experience.
- Use transferable wording when truthful. Examples: SQS/SNS can support event-driven messaging relevance; ECS/Fargate can support container/cloud deployment relevance; AWS infrastructure can support cloud/platform relevance.
- Strengthen SaaS, enterprise product, frontend architecture, API integration,
  scalability, reliability, performance, ownership, collaboration, and product
  impact language when supported by the source resume.
- For frontend roles, emphasize React, TypeScript, UI architecture, reusable
  components, responsive UI, state management, API integration, performance,
  UX, product collaboration, and enterprise SaaS experience when supported.
- For backend roles, emphasize Node.js, APIs, databases, auth, scalability,
  reliability, distributed systems, cloud, observability, and production support.
- For full-stack roles, emphasize end-to-end ownership, React + Node.js,
  product delivery, API integration, databases, cloud, and production systems.
- Use strong action verbs: Built, Designed, Developed, Delivered, Improved,
  Integrated, Optimized, Owned, Collaborated, Implemented.
- Prefer achievements and impact over generic duties.
- If exact numbers are not in the source resume, do NOT invent numbers.
- Avoid weak phrases like "responsible for" when possible.
- Keep bullets concise, specific, and credible. Target 15–25 words per bullet. Longer is not better.
- Each bullet must follow action → outcome: "[Strong verb] [what you did] [result or scope]".

ATS KEYWORD RULES
- Extract important keywords from the vacancy even if they are not in the static detected keyword list.
- Use exact job keywords only when they are supported by the source resume.
- If a critical keyword is missing from the source resume, do not add it to Skills. Mention adjacent real experience only when natural and truthful.
- Put the most relevant supported keywords in the first half of the resume.
- ATS optimization is limited to reordering, emphasizing, and placing allowed source-resume keywords.
- Never add a technology to Summary, Skills, Experience, or Technologies lines unless it appears in the allowlist.

════════════════════════════════════════
RESUME QUALITY RULES
════════════════════════════════════════
- Treat every generated resume as custom for this exact company, role, and posting.
- Mirror the job posting's important supported keywords in the target title line,
  summary, Skills, and most relevant Experience bullets.
- Put the strongest 2-3 supported achievements or high-impact contributions in
  the top third of the resume through the summary and first Experience role.
- Prefer achievement bullets over responsibility bullets. When source metrics
  exist, keep them. When metrics do not exist, state concrete scope, systems,
  users, product areas, or technical outcomes without inventing numbers.
- Keep paragraphs short. The summary must be one compact paragraph; Experience
  content must be scan-friendly bullets, not dense paragraph blocks.
- Do not include an Objective section or objective-style wording. The header
  target line and summary replace objectives.
- Use role and industry jargon selectively: include terms from the job posting
  only when backed by the source resume, and avoid overloading bullets with
  buzzwords that do not add evidence.
- Keep the resume within 1-2 pages when rendered. Prioritize recent, relevant,
  supported content and remove older or off-target detail first.
- Do not include sensitive personal identifiers such as national ID, social
  security numbers, passport numbers, license numbers, birth date, marital
  status, or non-professional affiliations unless already required by the
  existing source resume structure.
- Preserve professional links only when present and relevant. Do not invent or
  rewrite URLs; broken or unclear links from the source should not be expanded.

════════════════════════════════════════
REJECTION-RISK REDUCTION
════════════════════════════════════════
The final resume should reduce likely rejection reasons by:
- Making relevant skills easy to find in the Skills section.
- Making the first experience strongly match the vacancy.
- Showing enterprise/SaaS/product relevance when truthful.
- Avoiding generic frontend/backend wording.
- Avoiding overclaiming.

════════════════════════════════════════
LENGTH
════════════════════════════════════════
- Less than 5 years of experience → target 1 page.
- 5 or more years of experience → target 1–2 pages maximum.
- Be concise.
- Remove or shorten sections irrelevant to this role.

════════════════════════════════════════
OUTPUT FORMAT
════════════════════════════════════════
Return a clean role-targeted resume using the same structure and style as the candidate source resume.
Keep the base resume template. Do not switch to a generic objective-style template.
This is an edit-in-place task, not a rewrite.
All non-editable lines must remain semantically and stylistically identical to the source resume.

1. Header:
   # FULL NAME
   Next line after the name: ${fixedHeaderTargetLine}
   Use that header target line exactly.
   Do not replace the role/title part with the vacancy title.
   Do not copy a long raw vacancy title, company suffixes, URLs, location notes, remote/hybrid notes, or marketing text.
   If you adjust header technologies, use only technologies from the allowlist and keep the role/title part unchanged.
   Do NOT include the literal label "Target title line:".
   Contact lines:
   Phone: <phone>    LinkedIn: <linkedin>
   Email: <email>    GitHub: <github>
   Location: <location>
   Languages: <languages>

2. ## Summary
   Use the heading exactly as "## Summary".
   Write one compact paragraph of 90–120 words immediately after the header.
   Structure: [Role identity] + [2–3 core skills matched to this vacancy] + [strongest proof point or differentiator from real experience].
   Start the paragraph with this exact fixed base role label: "${fixedRoleLabel}".
   Do not replace it with the vacancy title.
   Do not prepend seniority such as "Senior", "Principal", "Lead", or "Junior" unless it is already part of the fixed base role label.
   Match the vacancy direction through supported keywords and bullet emphasis, not by changing the fixed role label.
   Must emphasize supported experience relevant to this exact vacancy.
   If the source resume contains concrete metrics (scale, users, performance gains, reliability improvements), lead with the strongest one.
   The summary must be consistent with the target title line and Skills section.
   Do not use phrases like "I am passionate about" or "responsible for" — every sentence must assert a capability or outcome.
   CRITICAL: Do NOT mention any technology or keyword in the Summary unless it also appears in the Skills section. ATS systems flag keywords that appear in Summary but are missing from Skills — this causes automatic score deductions.

3. ## Skills
   Preserve all Skills category names and lines exactly as in the source resume.
   Do not add, remove, or rename any Skills category.
   You MAY reorder the comma-separated items within each existing Skills line to place the
   most vacancy-relevant technologies first — this is an ATS best practice (73% of recruiters
   scan skills before work history). Do not add items that are not already in the source resume.
   If an ATS keyword is not already represented in Skills, do not force it into Skills.
   Instead, use only source-supported wording in Summary or existing Experience bullets.
   Skills category guidance for this vacancy:
   ${buildSkillsSectionGuidance(job)}

4. ## Experience
   Reverse chronological.
   Preserve existing role headers, project lines, Technologies lines, and role order from the source resume.
   Rewrite only bullet text to improve ATS alignment while staying factual.
   For each position:
   ### YYYY – YYYY | Job Title | Company (Location)
   Project name line when present in the source resume.
   - 3–6 bullet points for recent/relevant roles
   - 2–4 bullet points for older/less relevant roles
   Technologies: comma-separated list
   The Technologies line must be consistent with the bullets above it:
   - Do not list a technology unless at least one bullet in that same position explicitly supports using it.
   - If there is no room to add a truthful supporting bullet, remove that technology from that position's Technologies line.
   - If React, Angular, Vue, HTML, CSS, Redux, Material UI, or frontend/UI skills are listed,
     include a bullet for frontend, UI, responsive interface, customer-facing screens,
     state management, or frontend API integration in that same position.
   - If NestJS, Express.js, Prisma, JWT, Zod, Swagger, or similar backend framework/tooling is listed,
     include a bullet that names it directly or clearly shows the supported backend framework/API/auth/validation work.
   - If AWS, Lambda, SQS, SNS, Docker, Kubernetes, CI/CD, monitoring, or production support are listed,
     include a bullet showing cloud, deployment, async workflows, reliability, observability,
     or production operations in that same position.
   - If MongoDB, PostgreSQL, Redis, DynamoDB, SQL, or NoSQL are listed,
     include a bullet showing data modeling, persistence, caching, reporting, or backend data workflows.
   - For full-stack roles, the most recent role must have both frontend and backend bullets when
     both frontend and backend technologies are listed.
   - Soft/product bullets such as ownership, tradeoffs, ambiguity, collaboration, and business impact
     must be connected to concrete supported delivery work, not stand alone as generic claims.

5. ## Education
   YYYY - YYYY    Program | Institution (Location)
   - Details

Do not include a separate Languages section because languages belong in the header.
If the base resume uses slightly different spacing or markdown conventions, prefer the base resume style
as long as the required sections remain readable.

Return ONLY the final tailored resume in Markdown.
Do NOT include analysis, explanations, comments, JSON, code fences, or preamble.
`.trim();
}

export function buildCoverLetterPrompt(
    job: Job,
    baseResume: string,
    fullName: string,
): string {
    return `
You are an expert technical cover letter writer.
Write a concise, authentic cover letter for the vacancy below.

════════════════════════════════════════
CANDIDATE SOURCE RESUME
════════════════════════════════════════
${baseResume}

════════════════════════════════════════
TARGET VACANCY
════════════════════════════════════════
${buildJobSummary(job)}

════════════════════════════════════════
AUTOMATIC JOB REQUIREMENT ANALYSIS
════════════════════════════════════════
${buildRequirementAnalysisBlock(job)}

════════════════════════════════════════
RULES
════════════════════════════════════════
- Write EXACTLY 4 paragraphs totalling 350–400 words. Count your words before finalising.
  Under 300 words is unacceptable — expand each paragraph until you hit the minimum.
- Use ONLY facts from the candidate source resume.
- Do NOT invent skills, employers, education, metrics, availability, or personal details.
  Do NOT mention technologies that do not appear in the source resume.
- Do NOT repeat the resume — each sentence must add information, not summarize the resume.

PARAGRAPH STRUCTURE (4 paragraphs, ~80–100 words each):
1. HOOK + COMPANY FIT: Open with a specific product, problem, or engineering challenge this company
   is solving (from the job description). Then connect your most relevant achievement to their need.
2. PROOF POINT 1: One concrete achievement with a metric that directly maps to their top requirement.
   Include exact numbers or scale (events/day, response time, coverage %, latency improvement).
3. PROOF POINT 2: A second achievement showing breadth or a complementary skill they need.
   Weave in 3–4 technical terms from the job description naturally.
4. CALL TO ACTION: One confident sentence about why this role is the right next step. One sentence
   offering to discuss further.

ADDITIONAL RULES:
- Start with: "Dear Hiring Manager," (or the named recruiter if clearly stated in the job description).
  Then IMMEDIATELY open paragraph 1 — a specific hook. Do NOT start with "I am writing to apply
  for" or "I was excited to see" or any generic statement.
- End with a professional close followed by:
  Sincerely,
  ${fullName}

════════════════════════════════════════
OUTPUT FORMAT
════════════════════════════════════════
Return only the cover letter text.
Separate paragraphs with a blank line.
Do NOT include explanation, commentary, JSON, code fences, or preamble.
`.trim();
}

function ensureCoverLetterFormat(content: string, fullName: string): string {
    const clean = normalizeSectionText(content);
    const escapedName = fullName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hasSignoff = new RegExp(escapedName, "i").test(clean);

    return hasSignoff ? clean : `${clean}\n\nSincerely,\n${fullName}`;
}

async function requireJobWithDescription(jobId: string, context: string): Promise<Job> {
    const job = await prisma.job.findUnique({ where: { id: jobId } });

    if (!job) {
        throw new Error(`Job not found: ${jobId}`);
    }

    if (!hasRealDescription(job.description)) {
        throw new Error(
            `Job description too short for ${context}. ` +
            `Minimum ${MIN_DESCRIPTION_LENGTH} chars. Job: "${job.title}" @ ${job.company ?? "Unknown"}`,
        );
    }

    return job;
}

async function callOpenAIForText(
    prompt: string,
    scope: string,
    jobId: string,
    userId: string,
): Promise<string> {
    const response = await getOpenAIClient().chat.completions.create({
        model: MODEL,
        temperature: 0.25,
        messages: [
            {
                role: "system",
                content:
                    "You are a precise technical career assistant. You optimize resumes truthfully and never invent candidate experience.",
            },
            { role: "user", content: prompt },
        ],
    });

    if (response.usage?.total_tokens) {
        await recordUsageEvent(userId, "OPENAI_TOKENS", response.usage.total_tokens, {
            scope,
            jobId,
            model: MODEL,
        }).catch((error: unknown) => {
            logger.warn(
                { error, scope, jobId, userId, model: MODEL },
                "[generation] Failed to record OpenAI token usage",
            );
        });
    }

    const rawContent = response.choices[0]?.message?.content;
    if (!rawContent) throw new Error(`Empty ${scope} response from OpenAI`);

    return normalizeSectionText(cleanAiText(rawContent));
}

function isHeaderContactLine(line: string): boolean {
    return /^(phone|email|linkedin|github|location|languages)\s*:/i.test(line) ||
        /\b(phone|email|linkedin|github|location|languages)\s*:/i.test(line) ||
        /(?:\+?\d[\d\s().-]{6,}|@|linkedin\.com|github\.com)/i.test(line);
}

function sanitizeAllowedTechnologiesInResume(content: string, allowedTechnologies: readonly string[]): string {
    const lines = normalizeSectionText(content).split("\n");

    return lines.map((line) => {
        const skillsMatch = /^([^:\n]{2,60}):\s*(.+)$/i.exec(line.trim());
        if (skillsMatch && !isHeaderContactLine(line) && !/^technologies:/i.test(line.trim())) {
            const filtered = filterAllowedTechnologyList(skillsMatch[2], allowedTechnologies);
            return filtered ? `${skillsMatch[1]}: ${filtered}` : "";
        }

        const technologiesMatch = /^(Technologies:\s*)(.+)$/i.exec(line.trim());
        if (technologiesMatch) {
            const filtered = filterAllowedTechnologyList(technologiesMatch[2], allowedTechnologies);
            return filtered ? `${technologiesMatch[1]}${filtered}` : "";
        }

        return line;
    }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function canonicalSectionHeading(line: string): "summary" | "skills" | "experience" | "education" | null {
    const value = line.trim().replace(/^#+\s*/, "").toLowerCase();
    if (value === "summary" || value === "professional summary") return "summary";
    if (value === "skills") return "skills";
    if (value === "experience" || value === "work experience" || value === "professional experience") return "experience";
    if (value === "education") return "education";
    return null;
}

function extractBaseSectionHeadings(baseResume: string) {
    const headings: Partial<Record<"summary" | "skills" | "experience" | "education", string>> = {};
    for (const line of normalizeSectionText(baseResume).split("\n")) {
        const key = canonicalSectionHeading(line);
        if (key && !headings[key]) headings[key] = line.trim();
    }
    return headings;
}

function extractBaseHeaderPrefix(baseResume: string, fixedTargetTitle: string): string[] {
    const lines = normalizeSectionText(baseResume).split("\n");
    const firstSectionIndex = lines.findIndex((line) => canonicalSectionHeading(line) !== null);
    const preSectionLines = (firstSectionIndex >= 0 ? lines.slice(0, firstSectionIndex) : lines.slice(0, 6))
        .map((line) => line.trim())
        .filter(Boolean);
    const headerLines = preSectionLines.filter((line, index) =>
        index < 2 || isHeaderContactLine(line),
    );

    if (headerLines.length >= 2) {
        headerLines[1] = headerLines[1] || fixedTargetTitle;
    } else if (headerLines.length === 1) {
        headerLines.push(fixedTargetTitle);
    }

    return headerLines;
}

function firstGeneratedSectionIndex(lines: string[]): number {
    const sectionIndex = lines.findIndex((line) => canonicalSectionHeading(line) !== null);
    if (sectionIndex >= 0) return sectionIndex;

    const languagesIndex = lines.findIndex((line) => /^languages\s*:/i.test(line.trim()) || /\blanguages\s*:/i.test(line.trim()));
    return languagesIndex >= 0 ? languagesIndex + 1 : Math.min(lines.length, 6);
}

function isBulletLine(line: string): boolean {
    return /^\s*(?:[-*•●])\s+/.test(line);
}

function isExperienceRoleHeader(line: string): boolean {
    return /\b(?:19|20)\d{2}\b/.test(line) && /\|/.test(line);
}

function isTechnologiesLine(line: string): boolean {
    return /^Technologies:/i.test(line.trim());
}

function bulletPrefix(line: string): string {
    return /^(\s*(?:[-*•●])\s+)/.exec(line)?.[1] ?? "●\t";
}

function bulletText(line: string): string {
    return line.replace(/^\s*(?:[-*•●])\s+/, "").trim();
}

function nextSectionIndex(lines: string[], startIndex: number): number {
    const next = lines.findIndex((line, index) => index > startIndex && canonicalSectionHeading(line) !== null);
    return next >= 0 ? next : lines.length;
}

function extractSummaryBody(content: string, baseResume: string): string[] {
    const lines = normalizeSectionText(content).split("\n");
    const summaryIndex = lines.findIndex((line) => canonicalSectionHeading(line) === "summary");
    if (summaryIndex >= 0) {
        return lines
            .slice(summaryIndex + 1, nextSectionIndex(lines, summaryIndex))
            .map((line) => line.trim())
            .filter(Boolean);
    }

    const baseHeaderLength = extractBaseHeaderPrefix(baseResume, extractBaseHeaderTargetLine(baseResume)).length;
    const firstSection = firstGeneratedSectionIndex(lines);
    return lines
        .slice(Math.min(baseHeaderLength, firstSection), firstSection)
        .map((line) => line.trim())
        .filter(Boolean);
}

function replaceSummaryBody(baseLines: string[], generatedSummaryLines: string[], baseResume: string): string[] {
    if (generatedSummaryLines.length === 0) return baseLines;

    const summaryIndex = baseLines.findIndex((line) => canonicalSectionHeading(line) === "summary");
    if (summaryIndex >= 0) {
        const end = nextSectionIndex(baseLines, summaryIndex);
        return [
            ...baseLines.slice(0, summaryIndex + 1),
            ...generatedSummaryLines,
            ...baseLines.slice(end),
        ];
    }

    const firstSection = firstGeneratedSectionIndex(baseLines);
    const baseHeaderLength = extractBaseHeaderPrefix(baseResume, extractBaseHeaderTargetLine(baseResume)).length;
    const start = Math.min(baseHeaderLength, firstSection);
    return [
        ...baseLines.slice(0, start),
        ...generatedSummaryLines,
        ...baseLines.slice(firstSection),
    ];
}


type RoleBlock = {
    /** index of the role-header line within the full `lines` array */
    headerIndex: number;
    /** indices (within `lines`) of editable bullet/paragraph slots, in order */
    editableSlotIndices: number[];
};

function collectExperienceRoleBlocks(lines: string[]): RoleBlock[] {
    const experienceIndex = lines.findIndex(
        (line) => canonicalSectionHeading(line) === "experience",
    );
    if (experienceIndex < 0) return [];

    const end = nextSectionIndex(lines, experienceIndex);
    const blocks: RoleBlock[] = [];
    let current: RoleBlock | null = null;
    let nonEmptySinceRoleHeader = 0;

    for (let i = experienceIndex + 1; i < end; i += 1) {
        const trimmed = lines[i].trim();
        if (!trimmed) continue;

        if (isExperienceRoleHeader(trimmed)) {
            current = { headerIndex: i, editableSlotIndices: [] };
            blocks.push(current);
            nonEmptySinceRoleHeader = 0;
            continue;
        }

        // bullets/paragraphs before the first role header have no owner; skip them
        if (!current) continue;

        if (isTechnologiesLine(trimmed)) continue;

        nonEmptySinceRoleHeader += 1;
        const editable = isBulletLine(lines[i]) || nonEmptySinceRoleHeader >= 2;
        if (editable) current.editableSlotIndices.push(i);
    }

    return blocks;
}

function extractGeneratedExperienceByRole(content: string): string[][] {
    const lines = normalizeSectionText(content).split("\n");
    const experienceIndex = lines.findIndex(
        (line) => canonicalSectionHeading(line) === "experience",
    );
    if (experienceIndex < 0) return [];

    const end = nextSectionIndex(lines, experienceIndex);
    const perRole: string[][] = [];
    let current: string[] | null = null;
    let nonEmptySinceRoleHeader = 0;

    for (let i = experienceIndex + 1; i < end; i += 1) {
        const trimmed = lines[i].trim();
        if (!trimmed) continue;

        if (isExperienceRoleHeader(trimmed)) {
            current = [];
            perRole.push(current);
            nonEmptySinceRoleHeader = 0;
            continue;
        }
        if (!current) continue;
        if (isTechnologiesLine(trimmed)) continue;

        nonEmptySinceRoleHeader += 1;
        if (isBulletLine(lines[i])) {
            current.push(bulletText(lines[i]));
        } else if (nonEmptySinceRoleHeader >= 2) {
            current.push(trimmed);
        }
    }

    return perRole;
}

function replaceExperienceBulletsByRole(
    baseLines: string[],
    generatedByRole: string[][],
): string[] {
    if (generatedByRole.length === 0) return baseLines;

    const baseBlocks = collectExperienceRoleBlocks(baseLines);
    if (baseBlocks.length === 0) return baseLines;

    const result = [...baseLines];

    const roleCount = Math.min(baseBlocks.length, generatedByRole.length);
    if (baseBlocks.length !== generatedByRole.length) {
        logger.warn(
            { baseRoles: baseBlocks.length, generatedRoles: generatedByRole.length },
            "[generation] Experience role count mismatch; mapping overlapping roles only",
        );
    }

    for (let r = 0; r < roleCount; r += 1) {
        const block = baseBlocks[r];
        const generatedBullets = generatedByRole[r];

        block.editableSlotIndices.forEach((lineIndex, slot) => {
            const nextBullet = generatedBullets[slot];
            if (nextBullet === undefined) return; // fewer generated -> keep base slot

            const baseLine = baseLines[lineIndex];
            result[lineIndex] = isBulletLine(baseLine)
                ? `${bulletPrefix(baseLine)}${nextBullet}`
                : nextBullet;
        });
    }

    return result;
}

function preserveBaseSkeletonWithGeneratedText(content: string, baseResume: string, fixedTargetTitle: string): string {
    const baseLines = normalizeSectionText(baseResume).split("\n");
    const baseHeader = extractBaseHeaderPrefix(baseResume, fixedTargetTitle);
    const firstSection = firstGeneratedSectionIndex(baseLines);
    const baseBody = baseLines.slice(firstSection);
    const baseSkeletonLines = [...baseHeader, ...baseBody];
    const withSummary = replaceSummaryBody(baseSkeletonLines, extractSummaryBody(content, baseResume), baseResume);

    return replaceExperienceBulletsByRole(withSummary, extractGeneratedExperienceByRole(content)).join("\n");
}

function ensureResumeDocumentFormat(content: string, baseResume: string): string {
    const allowedTechnologies = extractAllowedTechnologies(baseResume);
    const fixedTargetTitle = sanitizeHeaderTargetLine(
        extractBaseHeaderTargetLine(baseResume),
        allowedTechnologies,
    );

    return sanitizeAllowedTechnologiesInResume(
        preserveBaseSkeletonWithGeneratedText(content, baseResume, fixedTargetTitle),
        allowedTechnologies,
    );
}

function buildAtsRepairPrompt(job: Job, baseResume: string, currentResume: string, ats: ReturnType<typeof validateResumeAgainstJob>): string {
    const allowedTechnologies = extractAllowedTechnologies(baseResume);
    const fixedHeaderTargetLine = sanitizeHeaderTargetLine(
        extractBaseHeaderTargetLine(baseResume),
        allowedTechnologies,
    );
    const fixedRoleLabel = headerRolePart(fixedHeaderTargetLine);

    return `
You are repairing a generated technical resume after an ATS validation pass.
Improve the resume only enough to resolve the listed ATS issues and raise keyword alignment.

════════════════════════════════════════
CANDIDATE SOURCE RESUME
════════════════════════════════════════
${baseResume}

════════════════════════════════════════
TARGET VACANCY
════════════════════════════════════════
${buildJobSummary(job)}

════════════════════════════════════════
CURRENT GENERATED RESUME
════════════════════════════════════════
${currentResume}

════════════════════════════════════════
ATS VALIDATION RESULT
════════════════════════════════════════
Score: ${ats.score}/100
Role detected: ${ats.role}

Issues to fix:
${listOrFallback(ats.issues, "No structural issues. Improve keyword alignment only if truthful.")}

Matched keywords:
${listOrFallback(ats.matchedKeywords, "No matched keywords detected.")}

Missing important keywords from the vacancy:
${listOrFallback(ats.missingImportantKeywords, "No missing important keywords detected.")}

════════════════════════════════════════
REPAIR RULES
════════════════════════════════════════
- Use ONLY facts present in the candidate source resume or already truthfully present in the current resume.
- Preserve the base resume's visual structure and style. Do not redesign the template.
- Keep section order, heading style, contact layout, bullet style, and experience formatting aligned with the source resume.
- Edit only these content areas:
  1. Summary paragraph text.
  2. Existing Experience bullet text.
  3. Ordering of items WITHIN existing Skills category lines (reorder comma-separated items by relevance; do not add or remove items).
- Do NOT rename, add, or remove Skills categories or Skills category lines.
- Do NOT edit Experience headers, project lines, Technologies lines, Education, contact lines, languages, or section headings.
- Do NOT invent tools, metrics, responsibilities, employers, titles, seniority, education, or dates.
- Do NOT change the header title/role line. It must remain exactly:
  ${fixedHeaderTargetLine}
- The Summary must start with this same fixed base role label:
  ${fixedRoleLabel}
- Do not prepend or replace it with vacancy seniority/title wording.
- Technologies are strictly allowlisted. You may mention a technology only if it appears in this list:
  ${allowedTechnologies.length ? allowedTechnologies.join(", ") : "No explicit technologies detected in the source resume."}
- Do NOT add job technologies that are absent from the allowlist, even if listed as missing ATS keywords.
- Fix section structure, Summary alignment, keyword placement,
  and Experience bullet support for listed Technologies.
- Add a missing job keyword only if it is clearly supported by the candidate source resume.
- If a missing keyword is not supported, do not add it.
- Keep bullets concise: target 15–25 words per bullet, action → outcome format.
- Keep the same compact resume format.
- Preserve contact details exactly.
Skills category guidance for this vacancy:
${buildSkillsSectionGuidance(job)}
- Return ONLY the repaired resume in the same format as the current generated resume.
`.trim();
}

type MetricMode = "strip" | "flag";

type MetricFinding = {
    line: string;
    unsupportedNumbers: string[];
};

type MetricValidationResult = {
    content: string;
    findings: MetricFinding[];
};

function extractNumericTokens(text: string): string[] {
    const tokens: string[] = [];

    // 10k / 2.5M / 1.2bn style shorthand
    const shorthand = /(\d+(?:\.\d+)?)\s*([kmb])(?:n)?\b/gi;
    for (const m of text.matchAll(shorthand)) {
        const base = parseFloat(m[1]);
        const mult = m[2].toLowerCase() === "k" ? 1e3 : m[2].toLowerCase() === "m" ? 1e6 : 1e9;
        tokens.push(String(Math.round(base * mult)));
    }

    // plain numbers, with optional thousands separators and decimals
    const plain = /\$?\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\$?\b\d+(?:\.\d+)?\b/g;
    for (const m of text.matchAll(plain)) {
        const cleaned = m[0].replace(/[$,]/g, "");
        // skip if it was actually part of a shorthand match like "10k" (the "10")
        const idx = m.index ?? 0;
        const following = text.slice(idx + m[0].length, idx + m[0].length + 2);
        if (/^\s*[kmb]/i.test(following)) continue;
        tokens.push(cleaned.replace(/\.0+$/, ""));
    }

    return tokens;
}

/** Years (1900–2099) are dates, not metrics — never treat as invented numbers. */
function isYearLike(token: string): boolean {
    const n = Number(token);
    return Number.isInteger(n) && n >= 1900 && n <= 2099;
}

/** Trivial counts that carry no "achievement" weight. */
function isTrivialNumber(token: string): boolean {
    const n = Number(token);
    return Number.isFinite(n) && n <= 2;
}

/**
 * Build the set of numbers actually supported by the base resume.
 * A generated number is "supported" if the identical normalized token appears
 * in the base. (Deliberately strict: "40%" in prose needs "40" in the base.)
 */
function buildSupportedNumberSet(baseResume: string): Set<string> {
    return new Set(extractNumericTokens(baseResume));
}

function unsupportedNumbersInLine(line: string, supported: Set<string>): string[] {
    return extractNumericTokens(line).filter(
        (tok) => !isYearLike(tok) && !isTrivialNumber(tok) && !supported.has(tok),
    );
}

/**
 * Strip a clause containing an unsupported number. We remove from the nearest
 * preceding clause boundary (comma / "by" / "from") through the number's unit,
 * rather than nuking the whole bullet, to preserve the truthful remainder.
 */
function stripUnsupportedClause(line: string, supported: Set<string>): string {
    let out = line;

    // remove "by N%", "by Nx", "by N" achievement tails
    out = out.replace(
        /\s*,?\s*by\s+\$?\d[\d,.]*\s*(?:%|x|percent|times)?(?:\s*[kmb]n?\b)?/gi,
        (match) => (unsupportedNumbersInLine(match, supported).length ? "" : match),
    );

    // remove "from A to B" / "from As to Bs" deltas if either side is unsupported
    out = out.replace(
        /\s*,?\s*from\s+\$?\d[\d,.]*\s*\w*\s+to\s+\$?\d[\d,.]*\s*\w*/gi,
        (match) => (unsupportedNumbersInLine(match, supported).length ? "" : match),
    );

    // remove standalone "(N+ users)", "~N events/day", "N,NNN requests" fragments
    out = out.replace(
        /\s*[(~]?\s*\$?\d[\d,.]*\+?\s*(?:[kmb]n?\b)?\s*(?:users?|customers?|requests?|events?|records?|rows?|ms|seconds?|sec|minutes?|min|hours?|%)\b\)?/gi,
        (match) => (unsupportedNumbersInLine(match, supported).length ? "" : match),
    );

    return out.replace(/\s{2,}/g, " ").replace(/\s+([.,])/g, "$1").replace(/[,(]\s*$/g, "").trim();
}

/**
 * Validate (and optionally repair) generated prose against the base resume.
 * Only Summary and Experience bullet/paragraph lines are inspected; headers,
 * Technologies lines, Skills, Education and contact lines are left untouched.
 */
function validateProseMetrics(
    content: string,
    baseResume: string,
    mode: MetricMode = "strip",
): MetricValidationResult {
    const supported = buildSupportedNumberSet(baseResume);
    const lines = normalizeSectionText(content).split("\n");
    const findings: MetricFinding[] = [];

    let section: ReturnType<typeof canonicalSectionHeading> = null;

    const outLines = lines.map((line) => {
        const headingKey = canonicalSectionHeading(line);
        if (headingKey) {
            section = headingKey;
            return line;
        }

        const trimmed = line.trim();
        if (!trimmed) return line;

        const inEditableProse =
            section === "summary" ||
            (section === "experience" &&
                !isExperienceRoleHeader(trimmed) &&
                !isTechnologiesLine(trimmed));

        if (!inEditableProse) return line;

        const unsupported = unsupportedNumbersInLine(line, supported);
        if (unsupported.length === 0) return line;

        findings.push({ line: trimmed, unsupportedNumbers: unsupported });

        if (mode === "flag") return line;

        const repaired = stripUnsupportedClause(line, supported);
        // if stripping emptied a bullet, keep original minus the number rather than a blank
        return repaired.replace(/^[-*•●]?\s*$/, "").length ? repaired : line;
    });

    return {
        content: outLines.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
        findings,
    };
}

function prepareResumeForAts(content: string, baseResume: string): string {
    // Step 1: apply base skeleton + allowlist filter
    const formattedContent = ensureResumeDocumentFormat(content, baseResume);
    // Step 2: strip Technologies items not supported by bullets —
    // do NOT call ensureResumeDocumentFormat again here because
    // preserveBaseSkeletonWithGeneratedText would restore the base
    // Technologies lines (including unsupported items like Docker).
    const afterTechRemoval = removeUnsupportedTechnologiesFromExperience(formattedContent);
    const techCleaned = normalizeSectionText(
        sanitizeAllowedTechnologiesInResume(afterTechRemoval, extractAllowedTechnologies(baseResume)),
    );

    const mode: MetricMode = process.env.METRIC_VALIDATION_MODE === "flag" ? "flag" : "strip";
    const { content: metricSafe, findings } = validateProseMetrics(techCleaned, baseResume, mode);

    if (findings.length) {
        logger.warn(
            { findings, mode },
            "[generation] Unsupported numeric claims found in generated prose",
        );
    }
    return metricSafe;
}

async function recordAtsValidationEvent(
    job: Job,
    userId: string,
    scope: string,
    ats: ReturnType<typeof validateResumeAgainstJob>,
    attempt: number,
) {
    const metadata = {
        scope,
        attempt,
        jobId: job.id,
        company: job.company,
        title: job.title,
        atsScore: ats.score,
        atsRole: ats.role,
        atsIssues: ats.issues,
        atsMatchedKeywords: ats.matchedKeywords,
        atsMissingImportantKeywords: ats.missingImportantKeywords,
        atsMinScore: ATS_RESUME_MIN_SCORE,
    };

    await recordUsageEvent(userId, "OPENAI_TOKENS", 0, {
        ...metadata,
        event: "ATS_RESUME_VALIDATION",
    }).catch((error: unknown) => {
        logger.warn(
            { error, ...metadata, userId },
            "[generation] Failed to record ATS resume validation",
        );
    });

    const failed = ats.score < ATS_RESUME_MIN_SCORE || ats.issues.length > 0;
    if (failed) {
        logger.warn(
            { ...metadata, userId },
            "[generation] ATS resume validation found issues",
        );
    } else {
        logger.info(
            { ...metadata, userId },
            "[generation] ATS resume validation passed",
        );
    }
}

function isAtsPassing(ats: ReturnType<typeof validateResumeAgainstJob>) {
    return ats.score >= ATS_RESUME_MIN_SCORE && ats.issues.length === 0;
}

function isBetterAtsResult(
    candidate: ReturnType<typeof validateResumeAgainstJob>,
    current: ReturnType<typeof validateResumeAgainstJob>,
) {
    if (candidate.score !== current.score) return candidate.score > current.score;
    if (candidate.issues.length !== current.issues.length) return candidate.issues.length < current.issues.length;
    return candidate.missingImportantKeywords.length < current.missingImportantKeywords.length;
}

async function finalizeResumeContent(
    job: Job,
    content: string,
    userId: string,
    scope: string,
    baseResume: string,
): Promise<FinalizedResumeContent> {
    let bestContent = prepareResumeForAts(content, baseResume);
    let bestAts = validateResumeAgainstJob(job, bestContent);
    let bestAttempt = 0;

    await recordAtsValidationEvent(job, userId, scope, bestAts, bestAttempt);

    for (let attempt = 1; attempt <= ATS_RESUME_REPAIR_ATTEMPTS && !isAtsPassing(bestAts); attempt += 1) {
        const repairContent = await callOpenAIForText(
            buildAtsRepairPrompt(job, baseResume, bestContent, bestAts),
            `${scope}_ats_repair_${attempt}`,
            job.id,
            userId,
        );
        const candidateContent = prepareResumeForAts(repairContent, baseResume);
        const candidateAts = validateResumeAgainstJob(job, candidateContent);

        await recordAtsValidationEvent(job, userId, scope, candidateAts, attempt);

        if (isBetterAtsResult(candidateAts, bestAts)) {
            bestContent = candidateContent;
            bestAts = candidateAts;
            bestAttempt = attempt;
        }

        if (isAtsPassing(bestAts)) break;
    }

    const atsValidatedAt = new Date();
    const failed = !isAtsPassing(bestAts);

    logger.info(
        {
            scope,
            jobId: job.id,
            userId,
            bestAttempt,
            atsScore: bestAts.score,
            atsIssues: bestAts.issues,
            atsRepairAttempts: ATS_RESUME_REPAIR_ATTEMPTS,
        },
        "[generation] ATS resume repair loop finished",
    );

    if (ATS_RESUME_ENFORCE && failed) {
        throw new Error(
            `ATS resume validation failed: score ${bestAts.score}/${ATS_RESUME_MIN_SCORE}; ` +
            `${bestAts.issues.length ? bestAts.issues.join(" | ") : "score below threshold"}`,
        );
    }

    return {
        content: bestContent,
        atsScore: bestAts.score,
        atsIssues: bestAts.issues,
        atsMatchedKeywords: bestAts.matchedKeywords,
        atsMissingKeywords: bestAts.missingImportantKeywords,
        atsValidatedAt,
    };
}

export async function generateResumeForJob(
    jobId: string,
    options: GenerationOptions = {},
): Promise<{
    id: string;
    jobId: string;
    userId: string;
    content: string;
    format: string;
    filePath: string | null;
    pdfFilePath: string | null;
    atsScore: number | null;
    atsIssues: string[];
    atsMatchedKeywords: string[];
    atsMissingKeywords: string[];
    atsValidatedAt: Date | null;
}> {
    if (!options.userId) throw new Error("userId is required for resume generation");

    const job = await requireJobWithDescription(jobId, "resume generation");

    await assertUserLimit(options.userId, "RESUME_GENERATED");
    await assertUserLimit(options.userId, "OPENAI_TOKENS");

    // Always use selectResumeBaseForJob to pick the right base for the job type
    // (fullstack/backend/frontend). Without this, a missing resumeBaseIds falls back
    // to options.resumeBaseId which may be undefined → getWorkspaceCandidateProfile
    // returns isDefault=true (Backend) even for fullstack or frontend roles.
    const selectedResumeBaseId = (options.resumeBaseIds || !options.resumeBaseId)
        ? (await selectResumeBaseForJob(options.userId, job, options.resumeBaseId, options.resumeBaseIds)).id
        : options.resumeBaseId;
    const profile = await getWorkspaceCandidateProfile(options.userId, selectedResumeBaseId);
    if (!profile) throw new Error("Candidate profile not found for this user");

    const tailoringAnalysis = await loadLatestTailoringAnalysis(options.userId, job.id);

    let content = await callOpenAIForText(
        buildResumePrompt(job, profile.resume, tailoringAnalysis),
        "resume_generation",
        jobId,
        options.userId,
    );
    const finalized = await finalizeResumeContent(job, content, options.userId, "resume_generation", profile.resume);
    content = finalized.content;

    const folderName = slugify(`${job.company ?? "unknown"}-${job.title}`);
    const resumeFolder = `resumes/${options.userId}/${folderName}`;
    const resumeBaseName = buildCandidateResumeBaseName(
        profile.fullName,
        buildResumeCode(job.title),
    );

    await saveTextFile(resumeFolder, `${resumeBaseName}.md`, content);

    const docxPath = path.join(getStorageRoot(), resumeFolder, `${resumeBaseName}.docx`);
    const pdfPath = path.join(getStorageRoot(), resumeFolder, `${resumeBaseName}.pdf`);

    await createResumeDocxPreservingTemplate({
        content,
        baseContent: profile.resume,
        sourceFilePath: profile.resumeSourceFilePath,
        outputPath: docxPath,
    });

    const pdfFilePath = await createResumePdfFromDocx({
        content,
        docxPath,
        pdfPath,
        jobId,
        userId: options.userId,
        company: job.company,
        title: job.title,
        logMessage: "[generation] PDF generation failed; resume saved without PDF",
    });

    const resumeVersion = await prisma.resumeVersion.create({
        data: {
            jobId: job.id,
            userId: options.userId,
            content,
            format: "docx",
            filePath: docxPath,
            pdfFilePath,
            atsScore: finalized.atsScore,
            atsIssues: finalized.atsIssues,
            atsMatchedKeywords: finalized.atsMatchedKeywords,
            atsMissingKeywords: finalized.atsMissingKeywords,
            atsValidatedAt: finalized.atsValidatedAt,
        },
    });

    await recordUsageEvent(options.userId, "RESUME_GENERATED", 1, {
        jobId,
        company: job.company,
        title: job.title,
    });

    return { ...resumeVersion, pdfFilePath };
}

export async function regenerateResumeVersion(
    resumeVersionId: string,
    options: { resumeBaseId?: string; resumeBaseIds?: ResumeBaseSelectionMap; skipTokenLimit?: boolean } = {},
): Promise<{
    id: string;
    jobId: string;
    userId: string;
    content: string;
    format: string;
    filePath: string | null;
    pdfFilePath: string | null;
    atsScore: number | null;
    atsIssues: string[];
    atsMatchedKeywords: string[];
    atsMissingKeywords: string[];
    atsValidatedAt: Date | null;
}> {
    const existing = await prisma.resumeVersion.findUnique({
        where: { id: resumeVersionId },
        include: { job: true },
    });

    if (!existing) {
        throw new Error(`ResumeVersion not found: ${resumeVersionId}`);
    }

    if (!hasRealDescription(existing.job.description)) {
        throw new Error(
            `Job description too short for resume repair. ` +
            `Minimum ${MIN_DESCRIPTION_LENGTH} chars. Job: "${existing.job.title}" @ ${existing.job.company ?? "Unknown"}`,
        );
    }

    if (!options.skipTokenLimit) {
        await assertUserLimit(existing.userId, "OPENAI_TOKENS");
    }

    const selectedBaseId = options.resumeBaseIds
        ? (await selectResumeBaseForJob(existing.userId, existing.job, options.resumeBaseId, options.resumeBaseIds)).id
        : options.resumeBaseId;
    const profile = await getWorkspaceCandidateProfile(existing.userId, selectedBaseId);
    if (!profile) throw new Error("Candidate profile not found for this user");

    const tailoringAnalysis = await loadLatestTailoringAnalysis(existing.userId, existing.jobId);
    let content = await callOpenAIForText(
        buildResumePrompt(existing.job, profile.resume, tailoringAnalysis),
        "resume_repair",
        existing.jobId,
        existing.userId,
    );
    const finalized = await finalizeResumeContent(existing.job, content, existing.userId, "resume_repair", profile.resume);
    content = finalized.content;

    const folderName = slugify(`${existing.job.company ?? "unknown"}-${existing.job.title}`);
    const resumeFolder = `resumes/${existing.userId}/${folderName}`;
    const resumeBaseName = buildCandidateResumeBaseName(
        profile.fullName,
        buildResumeCode(existing.job.title),
    );

    const defaultDocxPath = path.join(getStorageRoot(), resumeFolder, `${resumeBaseName}.docx`);
    const defaultPdfPath = path.join(getStorageRoot(), resumeFolder, `${resumeBaseName}.pdf`);
    // Prefer paths derived from current STORAGE_DIR over stored absolute paths,
    // which may contain Docker-specific prefixes (/app/storage) that don't exist locally.
    const storedDocx = existing.filePath ? resolveStoragePath(
        path.isAbsolute(existing.filePath)
            ? path.relative("/app/storage", existing.filePath)
            : existing.filePath,
    ) : null;
    const storedPdf = existing.pdfFilePath ? resolveStoragePath(
        path.isAbsolute(existing.pdfFilePath)
            ? path.relative("/app/storage", existing.pdfFilePath)
            : existing.pdfFilePath,
    ) : null;
    const docxPath = storedDocx ?? defaultDocxPath;
    const pdfPath = storedPdf ?? defaultPdfPath;
    const mdPath = docxPath.replace(/\.docx$/i, ".md");

    await ensureDir(path.dirname(docxPath));
    await fs.writeFile(mdPath, content, "utf8");
    await createResumeDocxPreservingTemplate({
        content,
        baseContent: profile.resume,
        sourceFilePath: profile.resumeSourceFilePath,
        outputPath: docxPath,
    });

    const pdfFilePath = await createResumePdfFromDocx({
        content,
        docxPath,
        pdfPath,
        jobId: existing.jobId,
        userId: existing.userId,
        company: existing.job.company,
        title: existing.job.title,
        logMessage: "[generation] PDF generation failed during resume repair; resume saved without PDF",
    });

    return prisma.resumeVersion.update({
        where: { id: existing.id },
        data: {
            content,
            filePath: docxPath,
            pdfFilePath,
            atsScore: finalized.atsScore,
            atsIssues: finalized.atsIssues,
            atsMatchedKeywords: finalized.atsMatchedKeywords,
            atsMissingKeywords: finalized.atsMissingKeywords,
            atsValidatedAt: finalized.atsValidatedAt,
        },
    });
}

export async function generateCoverLetterForJob(
    jobId: string,
    options: GenerationOptions = {},
) {
    if (!options.userId) throw new Error("userId is required for cover letter generation");

    const job = await requireJobWithDescription(jobId, "cover letter generation");

    await assertUserLimit(options.userId, "OPENAI_TOKENS");

    // Always use selectResumeBaseForJob to pick the right base for the job type
    // (fullstack/backend/frontend). Without this, a missing resumeBaseIds falls back
    // to options.resumeBaseId which may be undefined → getWorkspaceCandidateProfile
    // returns isDefault=true (Backend) even for fullstack or frontend roles.
    const selectedResumeBaseId = (options.resumeBaseIds || !options.resumeBaseId)
        ? (await selectResumeBaseForJob(options.userId, job, options.resumeBaseId, options.resumeBaseIds)).id
        : options.resumeBaseId;
    const profile = await getWorkspaceCandidateProfile(options.userId, selectedResumeBaseId);
    if (!profile) throw new Error("Candidate profile not found for this user");

    const rawContent = await callOpenAIForText(
        buildCoverLetterPrompt(job, profile.resume, profile.fullName),
        "cover_letter_generation",
        jobId,
        options.userId,
    );

    const content = ensureCoverLetterFormat(rawContent, profile.fullName);
    const folderName = slugify(`${job.company ?? "unknown"}-${job.title}`);
    const folder = `resumes/${options.userId}/${folderName}`;
    const dir = path.join(getStorageRoot(), folder);
    const docxPath = path.join(dir, "cover-letter.docx");

    await ensureDir(dir);
    await createCoverLetterDocx(content, docxPath);
    await saveTextFile(folder, "cover-letter.txt", content);

    const coverLetter = await prisma.coverLetter.create({
        data: {
            jobId: job.id,
            userId: options.userId,
            content,
            filePath: docxPath,
        },
    });

    await recordUsageEvent(options.userId, "COVER_LETTER_GENERATED", 1, {
        jobId,
        company: job.company,
        title: job.title,
    });

    return coverLetter;
}

export async function generateApplicationPackageForJob(
    jobId: string,
    options: GenerationOptions = {},
): Promise<PackageResult> {
    const [resume, coverLetter] = await Promise.all([
        generateResumeForJob(jobId, options),
        generateCoverLetterForJob(jobId, options),
    ]);

    return {
        resume,
        coverLetter,
    };
}
