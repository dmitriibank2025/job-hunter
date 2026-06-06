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

const MODEL = "gpt-4.1-mini";
const OPENAI_TIMEOUT_MS = 60_000;
const MIN_DESCRIPTION_LENGTH = 500;

const JOB_KEYWORD_ALIASES = [
    "TypeScript", "JavaScript", "Node.js", "React", "Next.js", "Vue", "Angular",
    "Express", "NestJS", "PostgreSQL", "MySQL", "MongoDB", "Redis", "DynamoDB",
    "AWS", "Azure", "GCP", "Docker", "Kubernetes", "Kafka", "RabbitMQ",
    "REST", "GraphQL", "CI/CD", "Jest", "Playwright", "Cypress",
    "Prisma", "Mongoose", "Python", "Java", "Go", "PHP", "Laravel",
    "Ruby", "Rails", "Microservices", "Serverless", "SaaS", "AI", "LLM",
] as const;

const RESUME_CODE_MAP: Array<{ pattern: RegExp; code: string }> = [
    { pattern: /(frontend|front-end)/i,             code: "FEND" },
    { pattern: /(backend|back-end)/i,               code: "BEND" },
    { pattern: /(full[\s-]?stack|fullstack)/i,       code: "FSWD" },
    { pattern: /(devops|platform|cloud|infra)/i,     code: "CLOD" },
    { pattern: /(data|analytics|bi|machine\s?learn)/i, code: "DATA" },
    { pattern: /(mobile|ios|android)/i,              code: "MOBI" },
    { pattern: /(qa|quality|test\s?engineer)/i,      code: "QENG" },
    { pattern: /(security|devsec)/i,                 code: "SECU" },
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

function extractJobKeywords(description: string): string[] {
    const seen = new Set<string>();

    return JOB_KEYWORD_ALIASES.filter((keyword) => {
        const escaped = keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const matched = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i").test(description);

        if (!matched || seen.has(keyword.toLowerCase())) return false;
        seen.add(keyword.toLowerCase());
        return true;
    });
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

export function buildResumePrompt(job: Job, baseResume: string): string {
    const keywords = extractJobKeywords(job.description);
    const keywordsLine = keywords.length
        ? keywords.join(", ")
        : "No explicit technology keywords detected";

    return `
You are a professional resume writer. Your task is to tailor the candidate's
existing resume to a specific job vacancy — without inventing anything.
 
════════════════════════════════════════
CANDIDATE SOURCE RESUME
════════════════════════════════════════
${baseResume}
 
════════════════════════════════════════
TARGET VACANCY
════════════════════════════════════════
${buildJobSummary(job)}
 
════════════════════════════════════════
DETECTED JOB KEYWORDS
════════════════════════════════════════
${keywordsLine}
 
════════════════════════════════════════
STRICT RULES — READ CAREFULLY
════════════════════════════════════════
 
TRUTHFULNESS (most important):
- Use ONLY facts present in the candidate source resume.
- Do NOT invent: tools, skills, responsibilities, metrics, employers,
  project names, certificates, degrees, languages, or seniority levels.
- If the job requires a skill not in the source resume — do NOT add it.
  Emphasize the closest existing experience only if it genuinely exists.
- Copy all dates EXACTLY as written. Do not modify, estimate, or round any dates.
- Copy contact information EXACTLY as provided. Do not alter email, phone, or URLs.
 
KEYWORDS:
- Naturally incorporate the detected keywords ONLY where the candidate's
  experience already supports them.
- Do not force keywords that have no basis in the source resume.
 
PROFESSIONAL SUMMARY:
- Rewrite the summary section to emphasize the experience most relevant
  to THIS specific role.
- Keep it 3–4 sentences. Do not add new facts — reframe existing ones.
 
LENGTH:
- Less than 5 years of experience → target 1 page.
- 5 or more years of experience  → target 1–2 pages maximum.
- Be concise. Remove or shorten sections irrelevant to this role.
 
════════════════════════════════════════
OUTPUT FORMAT
════════════════════════════════════════
 
Return a clean Markdown resume with sections in this exact order
(omit a section entirely if it has no content):
 
1. # Full Name
   Contact line: email · phone · location · linkedin · github · portfolio
 
2. ## Professional Summary
   3–4 sentences tailored to this vacancy.
 
3. ## Skills
   Grouped by category (e.g. Languages, Frameworks, Databases, DevOps, Tools).
   Only skills present in the source resume.
 
4. ## Experience
   Reverse chronological. For each position:
   ### Job Title — Company (Location)
   Month YYYY – Month YYYY  (or "Present")
   - Bullet point achievements and responsibilities
   - Use strong action verbs (Built, Led, Reduced, Designed, etc.)
 
5. ## Education
   Degree, Institution (Location) — YYYY–YYYY
 
6. ## Languages
   Language: Level
 
Return ONLY the final tailored resume in Markdown.
Do NOT include any explanation, commentary, or preamble.
`.trim();
}

export function buildCoverLetterPrompt(
    job: Job,
    baseResume: string,
    fullName: string,
): string {
    return `
You are a professional cover letter writer.
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
RULES
════════════════════════════════════════
- Maximum 180 words.
- Use ONLY facts from the candidate source resume.
- Do NOT invent: skills, employers, education, metrics, or availability.
- Mention technologies only when they appear in the source resume
  AND are relevant to this vacancy.
- Do NOT repeat the resume — tell a short story that connects
  the candidate's background to this specific role.
- Start with: "Dear Hiring Manager,"
  (unless a named recruiter is clearly stated in the job description)
- End with a professional sign-off followed by the candidate's full name: ${fullName}
 
════════════════════════════════════════
OUTPUT FORMAT
════════════════════════════════════════
Return only the cover letter text.
Separate paragraphs with a blank line.
Do NOT include any explanation, commentary, or preamble.
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

    const response = await getOpenAIClient().chat.completions.create({
        model: MODEL,
        messages: [{ role: "user", content: buildResumePrompt(job, profile.resume) }],
    });

    if (response.usage?.total_tokens) {
        await recordUsageEvent(options.userId, "OPENAI_TOKENS", response.usage.total_tokens, {
            scope: "resume_generation",
            jobId,
            model: MODEL,
        });
    }

    const rawContent = response.choices[0]?.message?.content;
    if (!rawContent) throw new Error("Empty resume generation response from OpenAI");

    const content = normalizeSectionText(cleanAiText(rawContent));
    const folderName = slugify(`${job.company ?? "unknown"}-${job.title}`);
    const resumeFolder = `resumes/${options.userId}/${folderName}`;
    const resumeBaseName = buildCandidateResumeBaseName(
        profile.fullName,
        buildResumeCode(job.title),
    );

    await saveTextFile(resumeFolder, `${resumeBaseName}.md`, content);

    const docxPath = path.join(getStorageRoot(), resumeFolder, `${resumeBaseName}.docx`);
    const pdfPath  = path.join(getStorageRoot(), resumeFolder, `${resumeBaseName}.pdf`);

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

    const response = await getOpenAIClient().chat.completions.create({
        model: MODEL,
        messages: [
            {
                role: "user",
                content: buildCoverLetterPrompt(job, profile.resume, profile.fullName),
            },
        ],
    });

    if (response.usage?.total_tokens) {
        await recordUsageEvent(options.userId, "OPENAI_TOKENS", response.usage.total_tokens, {
            scope: "cover_letter_generation",
            jobId,
            model: MODEL,
        });
    }

    const rawContent = response.choices[0]?.message?.content;
    if (!rawContent) throw new Error("Empty cover letter generation response from OpenAI");

    const content = ensureCoverLetterFormat(cleanAiText(rawContent), profile.fullName);
    const folderName = slugify(`${job.company ?? "unknown"}-${job.title}`);
    const folder  = `resumes/${options.userId}/${folderName}`;
    const dir     = path.join(getStorageRoot(), folder);
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
