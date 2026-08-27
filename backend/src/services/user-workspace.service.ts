import {
    UserJobStatus,
    ResumeBaseTarget,
    SubscriptionPlan,
    UsageEventType,
    UserRole,
} from "@prisma/client";
import fs from "fs/promises";
import path from "path";
import mammoth from "mammoth";
import { hashPassword, verifyPassword } from "./password.service";
import { prisma } from "../infrastructure/prisma";
import { encrypt } from "../infrastructure/field-encryption.js";
import { getStorageRoot } from "./file-storage.service";
import { linkedInStorageStatePathForUser, validateLinkedInStorageStatePath } from "./linkedin-account.service";
import { BasicResumePdfTemplate, createBasicResumePdf } from "./resume-pdf.service";
import { convertDocxToPdf, createStyledResumeDocx } from "./docx.service";
import { invalidateMasterSkillsCache } from "./job-analyzer.service";

export type PlanLimit = {
    vacanciesPerDay: number;
    generatedResumesPerMonth: number;
    baseResumes: number;
    searchRunsPerDay: number;
    tokenBudgetPerMonth: number;
    resumeAdvice: "basic" | "full";
    statistics: "none" | "full";
    priorityCompanyInsights: boolean;
};

export const PLAN_LIMITS: Record<SubscriptionPlan, PlanLimit> = {
    FREE: {
        vacanciesPerDay: 25,
        generatedResumesPerMonth: 5,
        baseResumes: 1,
        searchRunsPerDay: 3,
        tokenBudgetPerMonth: 100_000,
        resumeAdvice: "basic",
        statistics: "none",
        priorityCompanyInsights: false,
    },
    PRO: {
        vacanciesPerDay: 300_000,
        generatedResumesPerMonth: 100_000,
        baseResumes: 10,
        searchRunsPerDay: 300_000,
        tokenBudgetPerMonth: 40_000_000,
        resumeAdvice: "full",
        statistics: "full",
        priorityCompanyInsights: true,
    },
};

export const TECHNOLOGY_CATALOG = [
    { name: "React", category: "Frontend" },
    { name: "Vue.js", category: "Frontend" },
    { name: "Angular", category: "Frontend" },
    { name: "Svelte", category: "Frontend" },
    { name: "TypeScript", category: "Languages" },
    { name: "JavaScript", category: "Languages" },
    { name: "Python", category: "Languages" },
    { name: "Go", category: "Languages" },
    { name: "Java", category: "Languages" },
    { name: "C++", category: "Languages" },
    { name: "C#", category: "Languages" },
    { name: "Ruby", category: "Languages" },
    { name: "PHP", category: "Languages" },
    { name: "Swift", category: "Languages" },
    { name: "Kotlin", category: "Languages" },
    { name: "HTML5", category: "Frontend" },
    { name: "CSS3", category: "Frontend" },
    { name: "Tailwind CSS", category: "Frontend" },
    { name: "Sass/SCSS", category: "Frontend" },
    { name: "Vite", category: "Frontend" },
    { name: "Material UI", category: "Frontend" },
    { name: "MUI Data Grid", category: "Frontend" },
    { name: "React Router", category: "Frontend" },
    { name: "Zustand", category: "Frontend" },
    { name: "TanStack React Query", category: "Frontend" },
    { name: "Axios", category: "Frontend" },
    { name: "Leaflet", category: "Frontend" },
    { name: "Next.js", category: "Frontend" },
    { name: "Node.js", category: "Backend" },
    { name: "Express", category: "Backend" },
    { name: "NestJS", category: "Backend" },
    { name: "Fastify", category: "Backend" },
    { name: "Spring Boot", category: "Backend" },
    { name: "Django", category: "Backend" },
    { name: "Flask", category: "Backend" },
    { name: "GraphQL", category: "Backend" },
    { name: "gRPC", category: "Backend" },
    { name: "WebSockets", category: "Backend" },
    { name: "PostgreSQL", category: "Databases" },
    { name: "MySQL", category: "Databases" },
    { name: "SQLite", category: "Databases" },
    { name: "MongoDB", category: "Databases" },
    { name: "Redis", category: "Databases" },
    { name: "DynamoDB", category: "Databases" },
    { name: "Oracle", category: "Databases" },
    { name: "Prisma", category: "Backend" },
    { name: "Mongoose", category: "Backend" },
    { name: "AWS", category: "Cloud" },
    { name: "AWS Lambda", category: "Cloud" },
    { name: "SQS", category: "Cloud" },
    { name: "SNS", category: "Cloud" },
    { name: "GCP", category: "Cloud" },
    { name: "Azure", category: "Cloud" },
    { name: "Docker", category: "DevOps" },
    { name: "Docker Compose", category: "DevOps" },
    { name: "Kubernetes", category: "DevOps" },
    { name: "Terraform", category: "DevOps" },
    { name: "Git", category: "DevOps" },
    { name: "GitHub Actions", category: "DevOps" },
    { name: "GitLab CI", category: "DevOps" },
    { name: "Linux", category: "DevOps" },
    { name: "Nginx", category: "DevOps" },
    { name: "Kafka", category: "Backend" },
    { name: "Stripe", category: "Payments" },
    { name: "JWT", category: "Security" },
    { name: "Google OAuth", category: "Security" },
    { name: "RBAC", category: "Security" },
    { name: "Zod", category: "Backend" },
    { name: "Swagger/OpenAPI", category: "Documentation" },
    { name: "Jest", category: "Testing" },
    { name: "Supertest", category: "Testing" },
    { name: "Testing Library", category: "Testing" },
    { name: "Playwright", category: "Testing" },
    { name: "Claude Code", category: "AI-Assisted" },
    { name: "Cursor AI", category: "AI-Assisted" },
    { name: "GitHub Copilot", category: "AI-Assisted" },
    { name: "OpenAI Codex", category: "AI-Assisted" },
    { name: "React Native", category: "Mobile" },
    { name: "Expo", category: "Mobile" },
    { name: "Redux Toolkit", category: "Frontend" },
    { name: "MobX", category: "Frontend" },
    { name: "TanStack Table", category: "Frontend" },
    { name: "Storybook", category: "Frontend" },
    { name: "Cypress", category: "Testing" },
    { name: "Vitest", category: "Testing" },
    { name: "Mocha", category: "Testing" },
    { name: "Chai", category: "Testing" },
    { name: "Puppeteer", category: "Testing" },
    { name: "Cucumber", category: "Testing" },
    { name: "REST API", category: "Backend" },
    { name: "Microservices", category: "Architecture" },
    { name: "Event-Driven Architecture", category: "Architecture" },
    { name: "Clean Architecture", category: "Architecture" },
    { name: "CQRS", category: "Architecture" },
    { name: "DDD", category: "Architecture" },
    { name: "PostGIS", category: "Databases" },
    { name: "Elasticsearch", category: "Databases" },
    { name: "OpenSearch", category: "Databases" },
    { name: "RabbitMQ", category: "Backend" },
    { name: "BullMQ", category: "Backend" },
    { name: "Auth0", category: "Security" },
    { name: "OAuth 2.0", category: "Security" },
    { name: "OIDC", category: "Security" },
    { name: "Passport.js", category: "Security" },
    { name: "Helmet", category: "Security" },
    { name: "CI/CD", category: "DevOps" },
    { name: "Argo CD", category: "DevOps" },
    { name: "Helm", category: "DevOps" },
    { name: "Serverless", category: "Cloud" },
    { name: "CloudFormation", category: "Cloud" },
    { name: "API Gateway", category: "Cloud" },
    { name: "S3", category: "Cloud" },
    { name: "CloudWatch", category: "Cloud" },
    { name: "Firebase", category: "Cloud" },
    { name: "Supabase", category: "Cloud" },
    { name: "Vercel", category: "Cloud" },
    { name: "Netlify", category: "Cloud" },
    { name: "Stripe Connect", category: "Payments" },
    { name: "PayPal", category: "Payments" },
    { name: "Winston", category: "Observability" },
    { name: "Pino", category: "Observability" },
    { name: "Prometheus", category: "Observability" },
    { name: "Grafana", category: "Observability" },
    { name: "Sentry", category: "Observability" },
    { name: "Datadog", category: "Observability" },
    { name: "OpenTelemetry", category: "Observability" },
    { name: "Jira", category: "Productivity" },
    { name: "Confluence", category: "Productivity" },
    { name: "Figma", category: "Design" },
    { name: "WebRTC", category: "Frontend" },
    { name: "i18next", category: "Frontend" },
    { name: "Framer Motion", category: "Frontend" },
    { name: "Three.js", category: "Frontend" },
    { name: "WebGL", category: "Frontend" },
    { name: "LLM APIs", category: "AI-Assisted" },
    { name: "RAG", category: "AI-Assisted" },
    { name: "LangChain", category: "AI-Assisted" },
    { name: "Vector Databases", category: "AI-Assisted" },
] as const;

export const LANGUAGE_OPTIONS = [
    "English",
    "Hebrew",
    "Russian",
    "Arabic",
    "French",
    "Spanish",
    "German",
    "Italian",
    "Portuguese",
    "Ukrainian",
    "Polish",
    "Dutch",
    "Chinese",
    "Japanese",
    "Korean",
] as const;

export const LINKEDIN_ACCOUNT_NOTICE =
    "Use a dedicated non-work LinkedIn account for automated search. Do not reuse an employer account. This application stores only Playwright browser storage state and never stores LinkedIn passwords.";

export type WorkspaceCandidateProfile = {
    fullName: string;
    email: string;
    linkedin?: string | null;
    github?: string | null;
    phone?: string | null;
    location?: string | null;
    languages?: string[];
    resume: string;
    resumeSourceFilePath?: string | null;
};

type ProfileInput = {
    fullName: string;
    email: string;
    location?: string | null;
    phone?: string | null;
    linkedin?: string | null;
    github?: string | null;
    portfolio?: string | null;
    languages?: string[];
    summary?: string | null;
    telegramBotToken?: string | null;
};

type ExperienceInput = {
    company: string;
    title: string;
    location?: string;
    startDate: string;
    endDate?: string;
    project?: string;
    description?: string;
    bullets?: string[];
    technologies?: string[];
    sortOrder?: number;
};

type EducationInput = {
    institution: string;
    program: string;
    location?: string;
    startDate?: string;
    endDate?: string;
    details?: string[];
    sortOrder?: number;
};

function cleanList(values?: string[]) {
    return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function section(title: string, body: string[]) {
    const filtered = body.filter(Boolean);
    return filtered.length ? [`## ${title}`, ...filtered].join("\n") : "";
}

function formatDateRange(start?: string | null, end?: string | null) {
    return [start, end || "Present"].filter(Boolean).join(" - ");
}

function selectTechnologyNames(
    technologies: Array<{ name: string; category: string }>,
    target: ResumeBaseTarget,
) {
    const frontend = new Set(["Frontend", "AI-Assisted", "Languages", "Security", "Testing", "Documentation"]);
    const backend = new Set(["Backend", "Databases", "Cloud", "DevOps", "Payments", "AI-Assisted", "Languages", "Security", "Testing", "Documentation"]);
    const categories =
        target === "FRONTEND" ? frontend :
            target === "BACKEND" ? backend :
                undefined;

    return technologies
        .filter((technology) => !categories || categories.has(technology.category))
        .map((technology) => technology.name);
}

export async function registerWorkspaceUser(input: {
    email: string;
    fullName?: string;
    password?: string;
    plan?: SubscriptionPlan;
    role?: UserRole;
}) {
    const email = input.email.trim().toLowerCase();
    const passwordHash = input.password ? await hashPassword(input.password) : undefined;
    const user = await prisma.appUser.upsert({
        where: { email },
        create: {
            email,
            passwordHash,
            plan: input.plan ?? "FREE",
            role: input.role ?? "USER",
            profile: input.fullName
                ? {
                    create: {
                        fullName: input.fullName,
                        email,
                    },
                }
                : undefined,
        },
        update: {
            plan: input.plan,
            role: input.role,
            ...(passwordHash ? { passwordHash } : {}),
            profile: input.fullName
                ? {
                    upsert: {
                        create: {
                            fullName: input.fullName,
                            email,
                        },
                        update: {
                            fullName: input.fullName,
                        },
                    },
                }
                : undefined,
        },
        include: { profile: true },
    });

    return {
        ...user,
        limits: PLAN_LIMITS[user.plan],
    };
}

export async function loginWorkspaceUser(input: {
    email: string;
    password?: string;
}) {
    const email = input.email.trim().toLowerCase();
    const user = await prisma.appUser.findUnique({
        where: { email },
        include: { profile: true },
    });

    if (!user) {
        throw new Error("User not found.");
    }

    if (user.passwordHash) {
        const pwCheck = input.password ? await verifyPassword(input.password, user.passwordHash) : { ok: false, needsRehash: false };
        if (!pwCheck.ok) {
            throw new Error("Invalid password.");
        }
        // Transparently upgrade legacy PBKDF2 hashes to argon2id after a successful login.
        if (pwCheck.needsRehash && input.password) {
            const upgraded = await hashPassword(input.password);
            await prisma.appUser.update({ where: { id: user.id }, data: { passwordHash: upgraded } });
        }
    } else if (input.password) {
        // If they don't have a password yet but entered one, set it!
        const passwordHash = await hashPassword(input.password);
        await prisma.appUser.update({
            where: { id: user.id },
            data: { passwordHash },
        });
    }

    return {
        ...user,
        limits: PLAN_LIMITS[user.plan],
    };
}

const RESUME_SECTION_NAMES = new Set([
    "SUMMARY", "SKILLS", "EXPERIENCE", "EDUCATION", "LANGUAGES", "PERSONAL PROJECTS",
]);

/**
 * Infer a resume target (FULLSTACK / FRONTEND / BACKEND) from the file name and
 * the resume header. Full-stack wins over the single-discipline matches because
 * "Full Stack" titles also contain "stack" but should not be read as backend.
 */
function inferResumeTargetFromText(text: string): "FULLSTACK" | "FRONTEND" | "BACKEND" {
    const t = text.toLowerCase();
    if (/\bfull[\s_-]*stack\b/.test(t)) return "FULLSTACK";
    if (/\bfront[\s_-]*end\b/.test(t)) return "FRONTEND";
    if (/\bback[\s_-]*end\b/.test(t)) return "BACKEND";
    return "FULLSTACK";
}

/**
 * Clean text extracted from an uploaded resume (PDF/DOCX).
 *
 * PDF extraction in particular introduces artifacts that corrupt downstream
 * generation: page-of-page markers ("-- 1 of 2 --") and hard line wraps that
 * split a single bullet across several lines. We strip the markers and re-join
 * wrapped continuation lines so the stored base text is one logical line per
 * bullet — which the prompt, skeleton-merge, and DOCX renderer all expect.
 */
export function cleanExtractedResumeText(raw: string): string {
    const lines = raw.replace(/\r\n/g, "\n").split("\n");
    const isPageMarker = (s: string) =>
        /^\s*-*\s*(page\s+)?\d+\s+of\s+\d+\s*-*\s*$/i.test(s) || /^\s*-{2,}\s*\d+\s*-{2,}\s*$/.test(s);
    const bulletRe = /^[•\-\*●]\s+/;
    const isStructural = (s: string) => {
        const t = s.trim();
        if (!t) return true;
        if (bulletRe.test(t)) return true;
        if (/\|/.test(t)) return true;                       // job/education header
        if (/^Technologies:/i.test(t)) return true;
        if (/^#+\s/.test(t)) return true;                    // markdown heading
        if (RESUME_SECTION_NAMES.has(t.replace(/^#+\s*/, "").toUpperCase())) return true;
        return false;
    };

    // A header/section line must never absorb a following line.
    const isHeaderOrSection = (s: string) => {
        const t = s.trim();
        return /\|/.test(t) || /^Technologies:/i.test(t) || /^#+\s/.test(t) ||
            RESUME_SECTION_NAMES.has(t.replace(/^#+\s*/, "").toUpperCase());
    };

    const out: string[] = [];
    for (const rawLine of lines) {
        const line = rawLine.replace(/\s+$/, "");
        const t = line.trim();
        if (isPageMarker(t)) continue;
        if (!t) { out.push(""); continue; }

        // Re-join PDF mid-line wraps. The current line is a continuation of the
        // previous bullet/sentence when the previous line is a bullet or plain
        // sentence (NOT a header/section) AND it does not end with terminal
        // punctuation (.!?:) — or it ends with an obviously incomplete token
        // (–, -, |, ,). This repairs splits like "...across all\nAPI surfaces"
        // and "2024 –\nPresent" without merging two complete bullets.
        const prev = out.length ? out[out.length - 1] : "";
        const prevT = prev.trim();
        const prevMergeable = Boolean(prevT) && !isHeaderOrSection(prevT);
        const curMergeable = !isStructural(t);
        const continuation = prevMergeable && curMergeable &&
            (!/[.!?:]$/.test(prevT) || /[–\-|,]$/.test(prevT) || /^[a-z(]/.test(t));
        if (continuation) {
            out[out.length - 1] = prev.endsWith("-") ? prev + t : `${prev} ${t}`;
            continue;
        }
        out.push(line);
    }

    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export async function saveUploadedResume(
    userId: string,
    fileName: string,
    base64Content: string,
) {
    const user = await prisma.appUser.findUniqueOrThrow({
        where: { id: userId },
        include: { profile: true },
    });

    if (!user.profile) {
        throw new Error("Complete the user profile before uploading a resume.");
    }

    const buffer = Buffer.from(base64Content, "base64");
    const { saveBinaryFile } = await import("./file-storage.service.js");
    const relativePath = await saveBinaryFile(`resumes/${userId}`, fileName, buffer);
    // Normalize to relative key for storage-route compatibility
    const relativeKey = relativePath.replace(/\\/g, "/").replace(/^.*resumes\//, "resumes/");
    await prisma.userProfile.update({
        where: { userId },
        data: { resumeFilePath: relativeKey },
    });

    let textContent = "";
    const ext = path.extname(fileName).toLowerCase();

    if (ext === ".txt" || ext === ".md") {
        textContent = buffer.toString("utf-8");
    } else if (ext === ".pdf") {
        const { PDFParse } = await import("pdf-parse");
        const parser = new PDFParse({ data: buffer });
        try {
            const data = await parser.getText();
            textContent = data.text;
        } catch (error) {
            console.error("Failed to parse PDF:", error);
            throw new Error("Failed to parse text from PDF file.");
        } finally {
            await parser.destroy().catch(() => undefined);
        }
    } else if (ext === ".docx") {
        try {
            const result = await mammoth.extractRawText({ buffer });
            textContent = result.value;
        } catch (error) {
            console.error("Failed to parse DOCX:", error);
            throw new Error("Failed to parse text from DOCX file.");
        }
    } else {
        throw new Error("Unsupported file type. Please upload .txt, .md, .pdf, or .docx.");
    }

    textContent = cleanExtractedResumeText(textContent);

    if (!textContent || textContent.trim().length < 50) {
        throw new Error("Extracted resume text is too short or empty. Please ensure the file contains readable text.");
    }

    await prisma.userResumeBase.updateMany({
        where: { userId },
        data: { isDefault: false },
    });

    const resumeBase = await prisma.userResumeBase.create({
        data: {
            userId,
            name: `Uploaded: ${fileName}`,
            // Infer the target from the FILE NAME only — the resume header often
            // says "Frontend-Focused Full Stack…", which would mis-classify a
            // Frontend resume as FULLSTACK. The file name is the explicit signal.
            target: inferResumeTargetFromText(fileName),
            targetTitle: "Uploaded Resume",
            content: textContent,
            sourceFilePath: relativePath,
            isDefault: true,
        },
    });

    return {
        resumeBase,
        resumeFilePath: relativePath,
    };
}

export async function getWorkspaceUser(userId: string) {
    const user = await prisma.appUser.findUniqueOrThrow({
        where: { id: userId },
        include: {
            profile: true,
            technologies: { orderBy: [{ category: "asc" }, { name: "asc" }] },
            experiences: { orderBy: [{ sortOrder: "asc" }, { startDate: "desc" }] },
            educations: { orderBy: [{ sortOrder: "asc" }, { endDate: "desc" }] },
            resumeBases: { orderBy: { createdAt: "desc" } },
            linkedinAccounts: { orderBy: { updatedAt: "desc" } },
            jobMatches: {
                orderBy: { updatedAt: "desc" },
                take: 50,
                include: { job: true },
            },
            blacklistedCompanies: {
                orderBy: { createdAt: "desc" },
                select: { id: true, name: true, createdAt: true },
            },
        },
    });

    // Never expose secrets (bot token) or raw chat binding to the client.
    // Surface a derived Telegram connection state instead.
    const profile = user.profile
        ? (() => {
            const { telegramBotToken, telegramChatId, ...safeProfile } = user.profile;
            return {
                ...safeProfile,
                telegramHasBotToken: Boolean(telegramBotToken),
                telegramConnected: Boolean(telegramChatId),
            };
        })()
        : user.profile;

    return {
        ...user,
        profile,
        limits: PLAN_LIMITS[user.plan],
        linkedinNotice: LINKEDIN_ACCOUNT_NOTICE,
    };
}

export async function upsertUserProfile(userId: string, input: ProfileInput) {
    const allowedLanguages = new Set<string>(LANGUAGE_OPTIONS);
    const languages = cleanList(input.languages).filter((language) => allowedLanguages.has(language));

    return prisma.userProfile.upsert({
        where: { userId },
        create: {
            userId,
            fullName: input.fullName,
            email: input.email.trim().toLowerCase(),
            location: input.location,
            phone: input.phone,
            linkedin: input.linkedin,
            github: input.github,
            portfolio: input.portfolio,
            languages,
            summary: input.summary,
            telegramBotToken: input.telegramBotToken ? encrypt(input.telegramBotToken) : null,
            // telegramChatId is managed by the connect flow (webhook), not profile saves.
        },
        update: {
            fullName: input.fullName,
            email: input.email.trim().toLowerCase(),
            location: input.location,
            phone: input.phone,
            linkedin: input.linkedin,
            github: input.github,
            portfolio: input.portfolio,
            languages,
            summary: input.summary,
            // Only touch the bot token when the caller actually sent the field,
            // so unrelated profile saves never wipe it. Empty string clears it.
            ...(input.telegramBotToken !== undefined
                ? { telegramBotToken: input.telegramBotToken ? encrypt(input.telegramBotToken) : null }
                : {}),
            // telegramChatId intentionally omitted — never client-managed.
        },
    });
}

export async function upsertUserJobMatch(userId: string, jobId: string, input: {
    matchScore?: number | null;
    analysis?: unknown;
    status?: UserJobStatus;
    applied?: boolean;
    ignored?: boolean;
    notes?: string | null;
}) {
    const now = new Date();
    const status =
        input.status ??
        (input.ignored ? "IGNORED" :
            input.applied ? "APPLIED" :
                input.matchScore != null || input.analysis != null ? "ANALYZED" :
                    undefined);

    return prisma.userJobMatch.upsert({
        where: { userId_jobId: { userId, jobId } },
        create: {
            userId,
            jobId,
            status: status ?? "NEW",
            matchScore: input.matchScore ?? null,
            analysis: input.analysis == null ? undefined : input.analysis,
            matchedAt: input.matchScore == null && input.analysis == null ? null : now,
            appliedAt: input.applied ? now : null,
            ignoredAt: input.ignored ? now : null,
            notes: input.notes?.trim() || null,
        },
        update: {
            status,
            matchScore: input.matchScore ?? undefined,
            analysis: input.analysis == null ? undefined : input.analysis,
            matchedAt: input.matchScore == null && input.analysis == null ? undefined : now,
            appliedAt: input.applied === undefined ? undefined : input.applied ? now : null,
            ignoredAt: input.ignored === undefined ? undefined : input.ignored ? now : null,
            notes: input.notes === undefined ? undefined : input.notes?.trim() || null,
        },
    });
}

export async function replaceUserTechnologies(userId: string, technologies: Array<{ name: string; category?: string; level?: string }>) {
    await prisma.userTechnology.deleteMany({ where: { userId } });

    if (!technologies.length) return [];

    await prisma.userTechnology.createMany({
        data: technologies.map((technology) => {
            const catalogItem = TECHNOLOGY_CATALOG.find((item) => item.name.toLowerCase() === technology.name.trim().toLowerCase());
            return {
                userId,
                name: catalogItem?.name ?? technology.name.trim(),
                category: technology.category?.trim() || catalogItem?.category || "Other",
                level: technology.level?.trim() || null,
            };
        }),
        skipDuplicates: true,
    });

    return prisma.userTechnology.findMany({
        where: { userId },
        orderBy: [{ category: "asc" }, { name: "asc" }],
    });
}

export async function replaceUserExperiences(userId: string, experiences: ExperienceInput[]) {
    await prisma.userExperience.deleteMany({ where: { userId } });

    if (!experiences.length) return [];

    await prisma.userExperience.createMany({
        data: experiences.map((experience, index) => ({
            userId,
            company: experience.company,
            title: experience.title,
            location: experience.location,
            startDate: experience.startDate,
            endDate: experience.endDate,
            project: experience.project,
            description: experience.description,
            bullets: cleanList(experience.bullets),
            technologies: cleanList(experience.technologies),
            sortOrder: experience.sortOrder ?? index,
        })),
    });

    return prisma.userExperience.findMany({
        where: { userId },
        orderBy: [{ sortOrder: "asc" }, { startDate: "desc" }],
    });
}

export async function replaceUserEducations(userId: string, educations: EducationInput[]) {
    await prisma.userEducation.deleteMany({ where: { userId } });

    if (!educations.length) return [];

    await prisma.userEducation.createMany({
        data: educations.map((education, index) => ({
            userId,
            institution: education.institution,
            program: education.program,
            location: education.location,
            startDate: education.startDate,
            endDate: education.endDate,
            details: cleanList(education.details),
            sortOrder: education.sortOrder ?? index,
        })),
    });

    return prisma.userEducation.findMany({
        where: { userId },
        orderBy: [{ sortOrder: "asc" }, { endDate: "desc" }],
    });
}

export async function upsertLinkedInAccount(userId: string, input: {
    email?: string;
    profileUrl?: string;
    storageStatePath?: string;
}) {
    const existing = await prisma.userLinkedInAccount.findUnique({ where: { userId } });
    const storageStatePath = validateLinkedInStorageStatePath(
        input.storageStatePath?.trim() || existing?.storageStatePath || linkedInStorageStatePathForUser(userId),
    );
    const data = {
        email: input.email?.trim().toLowerCase() || null,
        profileUrl: input.profileUrl?.trim() || null,
        storageStatePath,
        connectedAt: new Date(),
        isActive: true,
    };

    const account = existing
        ? await prisma.userLinkedInAccount.update({ where: { userId }, data })
        : await prisma.userLinkedInAccount.create({ data: { userId, ...data } });

    return {
        ...account,
        notice: LINKEDIN_ACCOUNT_NOTICE,
    };
}

export async function updateUserDailyAutomationSettings(userId: string, input: {
    enabled: boolean;
    time: string;
    timezone: string;
    resumeBaseIds?: {
        FULLSTACK?: string;
        BACKEND?: string;
        FRONTEND?: string;
    };
}) {
    const requestedIds = [
        input.resumeBaseIds?.FULLSTACK,
        input.resumeBaseIds?.BACKEND,
        input.resumeBaseIds?.FRONTEND,
    ].filter((id): id is string => Boolean(id));

    if (requestedIds.length) {
        const ownedCount = await prisma.userResumeBase.count({
            where: {
                userId,
                id: { in: requestedIds },
            },
        });

        if (ownedCount !== new Set(requestedIds).size) {
            throw new Error("One or more selected daily automation resume bases do not belong to this user.");
        }
    }

    return prisma.appUser.update({
        where: { id: userId },
        data: {
            dailyAutomationEnabled: input.enabled,
            dailyAutomationTime: input.time,
            dailyAutomationTimezone: input.timezone,
            dailyAutomationLastRunKey: null,
            dailyAutomationFullstackResumeBaseId: input.resumeBaseIds?.FULLSTACK ?? null,
            dailyAutomationBackendResumeBaseId: input.resumeBaseIds?.BACKEND ?? null,
            dailyAutomationFrontendResumeBaseId: input.resumeBaseIds?.FRONTEND ?? null,
        },
    });
}

export async function createUserResumeBase(userId: string, input: {
    name: string;
    target?: ResumeBaseTarget;
    targetTitle?: string;
    isDefault?: boolean;
    template?: BasicResumePdfTemplate;
}) {
    const user = await prisma.appUser.findUniqueOrThrow({
        where: { id: userId },
        include: {
            profile: true,
            technologies: true,
            experiences: { orderBy: [{ sortOrder: "asc" }, { startDate: "desc" }] },
            educations: { orderBy: [{ sortOrder: "asc" }, { endDate: "desc" }] },
            _count: { select: { resumeBases: true } },
        },
    });

    const limit = PLAN_LIMITS[user.plan].baseResumes;
    if (user._count.resumeBases >= limit) {
        throw new Error(`${user.plan} plan allows up to ${limit} base resume${limit === 1 ? "" : "s"}.`);
    }

    if (!user.profile) {
        throw new Error("Complete the user profile before creating a base resume.");
    }

    const target = input.target ?? "FULLSTACK";
    const selectedTechnologies = selectTechnologyNames(user.technologies, target);
    const content = buildResumeContent({
        profile: user.profile,
        technologies: selectedTechnologies,
        experiences: user.experiences,
        educations: user.educations,
        targetTitle: input.targetTitle,
    });

    if (input.isDefault) {
        await prisma.userResumeBase.updateMany({
            where: { userId },
            data: { isDefault: false },
        });
    }

    const resumeBase = await prisma.userResumeBase.create({
        data: {
            userId,
            name: input.name,
            target,
            targetTitle: input.targetTitle,
            content,
            isDefault: Boolean(input.isDefault),
        },
    });

    const pdfFilePath = await createResumeBasePdf(userId, resumeBase.id, content, input.template);

    return {
        ...resumeBase,
        pdfFilePath,
    };
}

export async function listUserResumeBases(userId: string) {
    const resumeBases = await prisma.userResumeBase.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
    });

    return Promise.all(resumeBases.map(async (resumeBase) => ({
        ...resumeBase,
        pdfFilePath: await resumeBasePdfPathIfExists(userId, resumeBase.id),
    })));
}

export async function updateUserResumeBase(userId: string, resumeBaseId: string, input: {
    name?: string;
    target?: ResumeBaseTarget;
    targetTitle?: string | null;
    content?: string;
    isDefault?: boolean;
    template?: BasicResumePdfTemplate;
}) {
    await prisma.userResumeBase.findFirstOrThrow({
        where: { id: resumeBaseId, userId },
    });

    if (input.isDefault) {
        await prisma.userResumeBase.updateMany({
            where: { userId, id: { not: resumeBaseId } },
            data: { isDefault: false },
        });
    }

    return prisma.userResumeBase.update({
        where: { id: resumeBaseId },
        data: {
            name: input.name?.trim(),
            target: input.target,
            targetTitle: input.targetTitle === undefined ? undefined : input.targetTitle?.trim() || null,
            content: input.content,
            isDefault: input.isDefault,
        },
    }).then(async (resumeBase) => {
        invalidateMasterSkillsCache(userId);
        return {
            ...resumeBase,
            pdfFilePath: input.content || input.template
                ? await createResumeBasePdf(userId, resumeBase.id, input.content ?? resumeBase.content, input.template)
                : resumeBasePdfPath(userId, resumeBase.id),
        };
    });
}

export async function deleteUserResumeBase(userId: string, resumeBaseId: string) {
    await prisma.userResumeBase.findFirstOrThrow({
        where: { id: resumeBaseId, userId },
    });

    await prisma.userResumeBase.delete({
        where: { id: resumeBaseId },
    });
    invalidateMasterSkillsCache(userId);
}

export async function recordUsageEvent(userId: string, type: UsageEventType, amount = 1, metadata?: unknown) {
    return prisma.userUsageEvent.create({
        data: {
            userId,
            type,
            amount,
            metadata: metadata == null ? undefined : metadata,
        },
    });
}

function startOfDay(date = new Date()) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMonth(date = new Date()) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}

async function getUsageSum(userId: string, type: UsageEventType, since: Date) {
    const result = await prisma.userUsageEvent.aggregate({
        where: {
            userId,
            type,
            createdAt: { gte: since },
        },
        _sum: { amount: true },
    });

    return result._sum.amount ?? 0;
}

export async function getUserUsageSnapshot(userId: string) {
    const user = await prisma.appUser.findUniqueOrThrow({
        where: { id: userId },
        select: { plan: true, status: true },
    });
    const limits = PLAN_LIMITS[user.plan];
    const [vacanciesToday, searchesToday, resumesThisMonth, tokensThisMonth] = await Promise.all([
        getUsageSum(userId, "VACANCY_COLLECTED", startOfDay()),
        getUsageSum(userId, "SEARCH_RUN", startOfDay()),
        getUsageSum(userId, "RESUME_GENERATED", startOfMonth()),
        getUsageSum(userId, "OPENAI_TOKENS", startOfMonth()),
    ]);

    return {
        plan: user.plan,
        status: user.status,
        limits,
        usage: {
            vacanciesToday,
            searchesToday,
            resumesThisMonth,
            tokensThisMonth,
        },
        remaining: {
            vacanciesToday: Math.max(limits.vacanciesPerDay - vacanciesToday, 0),
            searchesToday: Math.max(limits.searchRunsPerDay - searchesToday, 0),
            resumesThisMonth: Math.max(limits.generatedResumesPerMonth - resumesThisMonth, 0),
            tokensThisMonth: Math.max(limits.tokenBudgetPerMonth - tokensThisMonth, 0),
        },
    };
}

export async function assertUserLimit(userId: string, type: UsageEventType, amount = 1) {
    const snapshot = await getUserUsageSnapshot(userId);

    if (snapshot.status !== "ACTIVE") {
        throw new Error(`User subscription status is ${snapshot.status}.`);
    }

    const checks: Partial<Record<UsageEventType, { remaining: number; label: string }>> = {
        VACANCY_COLLECTED: {
            remaining: snapshot.remaining.vacanciesToday,
            label: "collected vacancies per day",
        },
        RESUME_GENERATED: {
            remaining: snapshot.remaining.resumesThisMonth,
            label: "generated resumes per month",
        },
        SEARCH_RUN: {
            remaining: snapshot.remaining.searchesToday,
            label: "search runs per day",
        },
        OPENAI_TOKENS: {
            remaining: snapshot.remaining.tokensThisMonth,
            label: "OpenAI tokens per month",
        },
    };
    const check = checks[type];

    if (check && check.remaining < amount) {
        throw new Error(`${snapshot.plan} plan limit reached for ${check.label}.`);
    }

    return snapshot;
}

export async function getVacancyCollectionAllowance(userId: string) {
    const snapshot = await getUserUsageSnapshot(userId);
    return snapshot.remaining.vacanciesToday;
}

export async function getWorkspaceCandidateProfile(userId: string, resumeBaseId?: string): Promise<WorkspaceCandidateProfile> {
    const user = await prisma.appUser.findUniqueOrThrow({
        where: { id: userId },
        include: {
            profile: true,
            resumeBases: {
                where: resumeBaseId ? { id: resumeBaseId } : undefined,
                orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
                take: 1,
            },
        },
    });

    if (!user.profile) {
        throw new Error("Complete the user profile before analyzing jobs or generating resumes.");
    }

    const resume = user.resumeBases[0]?.content;
    const resumeSourceFilePath = user.resumeBases[0]?.sourceFilePath;
    if (!resume) {
        throw new Error(resumeBaseId
            ? "Selected base resume was not found for this user."
            : "Create at least one base resume before analyzing jobs or generating resumes.");
    }

    return {
        fullName: user.profile.fullName,
        email: user.profile.email,
        linkedin: user.profile.linkedin,
        github: user.profile.github,
        phone: user.profile.phone,
        location: user.profile.location,
        languages: user.profile.languages,
        resume,
        resumeSourceFilePath,
    };
}

export async function listAdminUsers() {
    const users = await prisma.appUser.findMany({
        include: {
            profile: true,
            _count: {
                select: {
                    resumeBases: true,
                    technologies: true,
                    experiences: true,
                    educations: true,
                    linkedinAccounts: true,
                },
            },
        },
        orderBy: { createdAt: "desc" },
    });
    const usage = await prisma.userUsageEvent.groupBy({
        by: ["userId", "type"],
        _sum: { amount: true },
    });

    return users.map((user) => {
        const usageByType = usage
            .filter((item) => item.userId === user.id)
            .reduce<Record<string, number>>((acc, item) => {
                acc[item.type] = item._sum.amount ?? 0;
                return acc;
            }, {});

        return {
            ...user,
            limits: PLAN_LIMITS[user.plan],
            usage: usageByType,
            tokensUsed: usageByType.OPENAI_TOKENS ?? 0,
        };
    });
}

export async function getAdminUser(userId: string) {
    const [user, events] = await Promise.all([
        getWorkspaceUser(userId),
        prisma.userUsageEvent.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
            take: 100,
        }),
    ]);

    const usage = events.reduce<Record<string, number>>((acc, event) => {
        acc[event.type] = (acc[event.type] ?? 0) + event.amount;
        return acc;
    }, {});

    return {
        ...user,
        usage,
        tokensUsed: usage.OPENAI_TOKENS ?? 0,
        recentUsageEvents: events,
    };
}

function buildResumeContent(input: {
    profile: ProfileInput;
    technologies: string[];
    experiences: Array<{
        company: string;
        title: string;
        location?: string | null;
        startDate: string;
        endDate?: string | null;
        project?: string | null;
        description?: string | null;
        bullets: string[];
        technologies: string[];
    }>;
    educations: Array<{
        institution: string;
        program: string;
        location?: string | null;
        startDate?: string | null;
        endDate?: string | null;
        details: string[];
    }>;
    targetTitle?: string;
}) {
    const profile = input.profile;
    const titleLine = [
        input.targetTitle,
        ...input.technologies.filter((technology) =>
            /aws|node|typescript|nosql|postgres|redis|dynamodb|backend/i.test(technology),
        ).slice(0, 4),
    ].filter(Boolean).join(" | ");
    const header = [
        `# ${profile.fullName.toUpperCase()}`,
        profile.location ?? "",
        titleLine,
        profile.phone ? `Phone: ${profile.phone}` : "",
        profile.linkedin ? `LinkedIn: ${profile.linkedin}` : "",
        profile.email ? `Email: ${profile.email}` : "",
        profile.github ? `GitHub: ${profile.github}` : "",
        profile.portfolio ? `Portfolio: ${profile.portfolio}` : "",
        profile.languages?.length ? `Languages: ${profile.languages.join(", ")}` : "",
    ].filter(Boolean).join("\n");

    const skills = input.technologies.length ? input.technologies.join(", ") : "";
    const experience = input.experiences.map((item) => {
        const heading = `### ${item.title} | ${item.company}${item.location ? ` | ${item.location}` : ""}`;
        const project = item.project ? `Project: ${item.project}` : "";
        const dates = formatDateRange(item.startDate, item.endDate);
        const description = item.description || "";
        const bullets = item.bullets.map((bullet) => `- ${bullet}`);
        const technologies = item.technologies.length ? `Technologies: ${item.technologies.join(", ")}` : "";
        return [heading, dates, project, description, ...bullets, technologies].filter(Boolean).join("\n");
    });
    const education = input.educations.map((item) => {
        const heading = `### ${item.program} | ${item.institution}${item.location ? ` | ${item.location}` : ""}`;
        const dates = formatDateRange(item.startDate, item.endDate);
        const details = item.details.map((detail) => `- ${detail}`);
        return [heading, dates, ...details].filter(Boolean).join("\n");
    });

    return [
        header,
        profile.summary ?? "",
        section("Skills", [skills]),
        section("Experience", experience),
        section("Education", education),
    ].filter(Boolean).join("\n\n");
}

function resumeBasePdfPath(userId: string, resumeBaseId: string) {
    return path.join(getStorageRoot(), "users", userId, "resume-bases", `${resumeBaseId}.pdf`);
}

function resumeBasePdfKey(userId: string, resumeBaseId: string) {
    return `users/${userId}/resume-bases/${resumeBaseId}.pdf`;
}

async function resumeBasePdfPathIfExists(userId: string, resumeBaseId: string) {
    const { getObjectStorage, isS3Enabled } = await import("../infrastructure/object-storage.js");
    if (isS3Enabled()) {
        const key = resumeBasePdfKey(userId, resumeBaseId);
        return (await getObjectStorage().exists(key)) ? key : null;
    }
    const pdfPath = resumeBasePdfPath(userId, resumeBaseId);
    try {
        await fs.access(pdfPath);
        return pdfPath;
    } catch {
        return null;
    }
}

async function createResumeBasePdf(userId: string, resumeBaseId: string, content: string, _template: BasicResumePdfTemplate = "ATS") {
    const pdfPath = resumeBasePdfPath(userId, resumeBaseId);
    const docxPath = pdfPath.replace(/\.pdf$/, ".docx");
    // Always generate to local disk first (LibreOffice needs a real path)
    try {
        await createStyledResumeDocx(content, docxPath);
        await convertDocxToPdf({ docxPath, outputPath: pdfPath });
    } catch {
        await createBasicResumePdf(content, pdfPath, _template);
    }
    // Upload to S3 if enabled, return the relative key
    const { getObjectStorage, isS3Enabled } = await import("../infrastructure/object-storage.js");
    if (isS3Enabled()) {
        const key = resumeBasePdfKey(userId, resumeBaseId);
        const buffer = await fs.readFile(pdfPath);
        await getObjectStorage().put(key, buffer);
        return key;
    }
    return pdfPath;
}
