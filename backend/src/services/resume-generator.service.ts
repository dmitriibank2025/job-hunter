import OpenAI from "openai";
import { Job } from "@prisma/client";
import path from "path";
import {
    ensureDir,
    getStorageRoot,
    saveTextFile,
    slugify,
} from "./file-storage.service";
import { createCoverLetterDocx, createResumeDocx } from "./docx.service";
import { createBasicResumePdf } from "./resume-pdf.service";
import {
    assertUserLimit,
    getWorkspaceCandidateProfile,
    recordUsageEvent,
} from "./user-workspace.service";
import { logger } from "../Logger/logger";
import { prisma } from "../infrastructure/prisma";

const MODEL = process.env.RESUME_GENERATION_MODEL ?? "gpt-4.1-mini";
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS ?? 60_000);
const MIN_DESCRIPTION_LENGTH = Number(process.env.MIN_JOB_DESCRIPTION_LENGTH ?? 500);

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
};

type PackageResult = {
    resume: Awaited<ReturnType<typeof generateResumeForJob>>;
    coverLetter: Awaited<ReturnType<typeof generateCoverLetterForJob>>;
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

function escapeRegex(value: string): string {
    return value.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsPhrase(text: string, phrase: string): boolean {
    const escaped = escapeRegex(phrase);
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i").test(text);
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
- Do NOT invent tools, technologies, employers, responsibilities, metrics,
  project names, certificates, degrees, languages, awards, or seniority levels.
- Do NOT add skills that are not present in the source resume.
- If the job requires a missing skill, do NOT pretend the candidate has it.
- Emphasize the closest real experience only when it is genuinely supported
  by the source resume.
- Copy all dates EXACTLY as written.
- Copy contact information EXACTLY as written.
- Do not modify email, phone, LinkedIn, GitHub, location, or employer names.
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
- Keep bullets concise, specific, and credible.

ATS KEYWORD RULES
- Extract important keywords from the vacancy even if they are not in the static detected keyword list.
- Use exact job keywords only when they are supported by the source resume.
- If a critical keyword is missing from the source resume, do not add it to Skills. Mention adjacent real experience only when natural and truthful.
- Put the most relevant supported keywords in the first half of the resume.

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
Return a clean backend-focused resume in this exact structure.
Keep the agreed compact format. Do not switch to a generic "Professional Summary"
template.

1. Header:
   # FULL NAME
   Target title line: Senior Backend Developer | AWS | Node.js | TypeScript | NoSQL
   Contact lines:
   Phone: <phone>    LinkedIn: <linkedin>
   Email: <email>    GitHub: <github>
   Location: <location>
   Languages: <languages>

2. Summary paragraph:
   Do NOT use a "Professional Summary" heading.
   Write one compact paragraph of 90–130 words immediately after the header.
   Preserve backend positioning unless the selected source resume explicitly targets another direction.
   Must emphasize supported backend/cloud/security/reliability experience relevant to the vacancy.

3. ## Skills
   Use plain category lines, not Markdown bold.
   Prefer these categories when supported by the source resume:
   Languages:
   Backend:
   Cloud & Async:
   Databases & Cache:
   Security & Reliability:
   Infrastructure & Testing:
   Tools:
   AI-Assisted Development:
   Put the most job-relevant supported categories first.
   Only include skills present in the source resume.

4. ## Experience
   Reverse chronological.
   For each position:
   ### YYYY – YYYY | Job Title | Company (Location)
   Project name line when present in the source resume.
   - 3–6 bullet points for recent/relevant roles
   - 2–4 bullet points for older/less relevant roles
   Technologies: comma-separated list

5. ## Education
   YYYY - YYYY    Program | Institution (Location)
   - Details

Do not include a separate Languages section because languages belong in the header.

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
- Maximum 180 words.
- Use ONLY facts from the candidate source resume.
- Do NOT invent skills, employers, education, metrics, availability, or personal details.
- Mention technologies only when they appear in the source resume
  AND are relevant to this vacancy.
- Do NOT repeat the resume.
- Tell a short story connecting the candidate's real background to this specific role.
- Mention the company or product context only if it is clear from the vacancy.
- Start with: "Dear Hiring Manager,"
  unless a named recruiter is clearly stated in the job description.
- End with a professional sign-off followed by the candidate's full name: ${fullName}

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

    return hasSignoff ? clean : `${clean}\n\nBest regards,\n${fullName}`;
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
        });
    }

    const rawContent = response.choices[0]?.message?.content;
    if (!rawContent) throw new Error(`Empty ${scope} response from OpenAI`);

    return normalizeSectionText(cleanAiText(rawContent));
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
}> {
    if (!options.userId) throw new Error("userId is required for resume generation");

    const job = await requireJobWithDescription(jobId, "resume generation");

    await assertUserLimit(options.userId, "RESUME_GENERATED");
    await assertUserLimit(options.userId, "OPENAI_TOKENS");

    const profile = await getWorkspaceCandidateProfile(options.userId, options.resumeBaseId);
    if (!profile) throw new Error("Candidate profile not found for this user");

    const tailoringAnalysis = await loadLatestTailoringAnalysis(options.userId, job.id);

    const content = await callOpenAIForText(
        buildResumePrompt(job, profile.resume, tailoringAnalysis),
        "resume_generation",
        jobId,
        options.userId,
    );

    const folderName = slugify(`${job.company ?? "unknown"}-${job.title}`);
    const resumeFolder = `resumes/${options.userId}/${folderName}`;
    const resumeBaseName = buildCandidateResumeBaseName(
        profile.fullName,
        buildResumeCode(job.title),
    );

    await saveTextFile(resumeFolder, `${resumeBaseName}.md`, content);

    const docxPath = path.join(getStorageRoot(), resumeFolder, `${resumeBaseName}.docx`);
    const pdfPath = path.join(getStorageRoot(), resumeFolder, `${resumeBaseName}.pdf`);

    await createResumeDocx(content, docxPath);

    const pdfFilePath = await createBasicResumePdf(content, pdfPath, "ATS").catch((error: unknown) => {
        logger.error(
            { error, jobId, userId: options.userId, company: job.company, title: job.title },
            "[generation] PDF generation failed; resume saved without PDF",
        );
        return null;
    });

    const resumeVersion = await prisma.resumeVersion.create({
        data: {
            jobId: job.id,
            userId: options.userId,
            content,
            format: "docx",
            filePath: docxPath,
            pdfFilePath,
        },
    });

    await recordUsageEvent(options.userId, "RESUME_GENERATED", 1, {
        jobId,
        company: job.company,
        title: job.title,
    });

    return { ...resumeVersion, pdfFilePath };
}

export async function generateCoverLetterForJob(
    jobId: string,
    options: GenerationOptions = {},
) {
    if (!options.userId) throw new Error("userId is required for cover letter generation");

    const job = await requireJobWithDescription(jobId, "cover letter generation");

    await assertUserLimit(options.userId, "OPENAI_TOKENS");

    const profile = await getWorkspaceCandidateProfile(options.userId, options.resumeBaseId);
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
