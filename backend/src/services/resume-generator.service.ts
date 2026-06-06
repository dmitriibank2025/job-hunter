import OpenAI from "openai";
import { Job, PrismaClient } from "@prisma/client";
import path from "path";
import { ensureDir, getStorageRoot } from "./file-storage.service";
import { createCoverLetterDocx } from "./docx.service";
import { createResumePdfFromTemplate } from "./resume-pdf.service";
import { createResumeFromTemplate } from "./template-docx.service";
import { saveTextFile, slugify } from "./file-storage.service";
import {
    assertUserLimit,
    getWorkspaceCandidateProfile,
    recordUsageEvent,
} from "./user-workspace.service";

const prisma = new PrismaClient();

const MODEL = "gpt-4.1-mini";

const CANONICAL_SKILLS = `Languages: TypeScript, JavaScript, SQL, Python, Java
Backend: Node.js, Express.js, REST API, JWT, RBAC, Zod, Stripe Webhooks, Swagger/OpenAPI
Frontend: React, TypeScript, Vite, Material UI, MUI Data Grid, React Router, Zustand, Redux Toolkit, TanStack React Query, Axios
Cloud & Async: AWS Lambda, SQS, SNS, DynamoDB, AWS SDK, Kafka, Event-Driven Workflows
Databases & Cache: PostgreSQL, Prisma, Redis, MongoDB, Mongoose, DynamoDB
Infrastructure & Testing: Docker, Docker Compose, Kubernetes, LocalStack, Jest, Supertest, ESLint
AI-Assisted Development: Claude Code, Cursor AI, GitHub Copilot, OpenAI Codex`;

const HEADER_STACK_ALTERNATIVES: Record<string, string[]> = {
    Python: ["Node.js", "TypeScript"],
    Java: ["Node.js", "TypeScript"],
    Go: ["Node.js", "TypeScript"],
    "C++": ["Node.js", "TypeScript"],
    GCP: ["AWS"],
    Azure: ["AWS"],
    GraphQL: ["REST API"],
    Terraform: ["Docker"],
};

const HEADER_STACK_ALLOWED = new Set([
    "Node.js",
    "TypeScript",
    "JavaScript",
    "React",
    "Next.js",
    "Vite",
    "Material UI",
    "AWS",
    "AWS Lambda",
    "Docker",
    "Kubernetes",
    "PostgreSQL",
    "MongoDB",
    "Redis",
    "REST API",
    "Microservices",
    "Kafka",
    "SQL",
    "NoSQL",
    "DynamoDB",
    "NestJS",
    "Express.js",
    "Stripe",
]);

const HEADER_STACK_DEFAULTS = {
    backend: ["Node.js", "TypeScript", "AWS"],
    frontend: ["React", "TypeScript", "Next.js"],
    fullstack: ["Node.js", "React", "TypeScript"],
};

type ResumeRole = keyof typeof HEADER_STACK_DEFAULTS;

function detectHeaderRole(title: string): ResumeRole {
    const lower = title.toLowerCase();

    if (/(frontend|front-end)/i.test(lower) && !/(full[\s-]?stack|fullstack|backend|back-end)/i.test(lower)) {
        return "frontend";
    }

    if (/(backend|back-end)/i.test(lower) && !/(full[\s-]?stack|fullstack|frontend|front-end)/i.test(lower)) {
        return "backend";
    }

    return "fullstack";
}

function isTechAllowedForRole(tech: string, role: ResumeRole): boolean {
    if (role === "backend") {
        return !["React", "Next.js", "Vite", "Material UI"].includes(tech);
    }

    if (role === "frontend") {
        return ![
            "Node.js",
            "AWS",
            "AWS Lambda",
            "PostgreSQL",
            "MongoDB",
            "Redis",
            "Microservices",
            "Kafka",
            "RabbitMQ",
            "DynamoDB",
            "NestJS",
            "Express.js",
            "Stripe",
        ].includes(tech);
    }

    return true;
}

function completeHeaderStack(
    stack: string[],
    role: ResumeRole,
): string[] {
    const result = stack.filter((tech) => isTechAllowedForRole(tech, role));

    for (const tech of HEADER_STACK_DEFAULTS[role]) {
        if (result.length >= 3) break;
        if (!result.some((item) => item.toLowerCase() === tech.toLowerCase())) {
            result.push(tech);
        }
    }

    return result.slice(0, 5);
}

function getOpenAIClient(): OpenAI {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey || !apiKey.startsWith("sk-")) {
        throw new Error("OPENAI_API_KEY is missing or invalid");
    }

    return new OpenAI({
        apiKey,
    });
}

function buildTargetTitle(job: Job): string {
    const title = job.title.toLowerCase();
    const description = job.description.toLowerCase();
    const text = `${title} ${description}`;

    const isSenior =
        title.includes("senior") ||
        title.includes("lead") ||
        title.includes("principal");

    const isFrontend =
        title.includes("frontend") ||
        title.includes("front-end") ||
        text.includes("frontend developer") ||
        text.includes("front-end developer");

    const isBackend =
        title.includes("backend") ||
        title.includes("back-end") ||
        text.includes("backend developer") ||
        text.includes("back-end developer");

    const isFullstack =
        title.includes("fullstack") ||
        title.includes("full-stack") ||
        title.includes("full stack") ||
        text.includes("full stack developer") ||
        text.includes("full-stack developer");

    const isAiFocused =
        title.includes("ai") ||
        title.includes("llm") ||
        title.includes("agentic") ||
        title.includes("machine learning") ||
        description.includes("llm") ||
        description.includes("agentic ai") ||
        description.includes("ai integration");

    if (isFrontend) {
        return isSenior
            ? "Senior Frontend Developer | React | TypeScript | Next.js"
            : "Frontend Developer | React | TypeScript | Next.js";
    }

    if (isBackend) {
        return isSenior
            ? "Senior Backend Developer | Node.js | TypeScript | AWS"
            : "Backend Developer | Node.js | TypeScript | AWS";
    }

    if (isFullstack) {
        if (isAiFocused) {
            return isSenior
                ? "Senior Full-stack Developer | AI Applications | Node.js | React | AWS"
                : "Full-stack Developer | AI Applications | Node.js | React | AWS";
        }

        return isSenior
            ? "Senior Full-stack Developer | Node.js | React | AWS"
            : "Full-stack Developer | Node.js | React | AWS";
    }

    if (isAiFocused) {
        return isSenior
            ? "Senior Full-stack Developer | Node.js | TypeScript | AWS"
            : "Full-stack Developer | Node.js | TypeScript | AWS";
    }

    return isSenior
        ? "Senior Full-stack Developer | Node.js | React | AWS"
        : "Full-stack Developer | Node.js | React | AWS";
}

function normalizeTechName(value: string): string {
    const normalized = value.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").trim();
    const names: Record<string, string> = {
        "node js": "Node.js",
        nodejs: "Node.js",
        typescript: "TypeScript",
        javascript: "JavaScript",
        react: "React",
        vite: "Vite",
        mui: "Material UI",
        "material ui": "Material UI",
        next: "Next.js",
        "next js": "Next.js",
        aws: "AWS",
        "aws lambda": "AWS Lambda",
        docker: "Docker",
        kubernetes: "Kubernetes",
        postgresql: "PostgreSQL",
        postgres: "PostgreSQL",
        mongodb: "MongoDB",
        redis: "Redis",
        python: "Python",
        java: "Java",
        "c++": "C++",
        go: "Go",
        golang: "Go",
        graphql: "GraphQL",
        rest: "REST API",
        "rest api": "REST API",
        "rest apis": "REST API",
        microservices: "Microservices",
        microservice: "Microservices",
        kafka: "Kafka",
        rabbitmq: "RabbitMQ",
        terraform: "Terraform",
        gcp: "GCP",
        azure: "Azure",
        sql: "SQL",
        nosql: "NoSQL",
        dynamodb: "DynamoDB",
        elasticsearch: "Elasticsearch",
        nestjs: "NestJS",
        nest: "NestJS",
        express: "Express.js",
        "express js": "Express.js",
        stripe: "Stripe",
    };

    return names[normalized] ?? value.trim();
}

function buildTargetStack(job: Job): string {
    const patterns = [
        /\bnode(?:\.js|js)?\b/i,
        /\btypescript\b/i,
        /\bjavascript\b/i,
        /\breact\b/i,
        /\bvite\b/i,
        /\bmaterial\s+ui\b|\bmui\b/i,
        /\bnext(?:\.js)?\b/i,
        /\baws(?:\s+lambda)?\b/i,
        /\bdocker\b/i,
        /\bkubernetes\b/i,
        /\bpostgres(?:ql)?\b/i,
        /\bmongodb\b/i,
        /\bredis\b/i,
        /\bpython\b/i,
        /\bjava\b/i,
        /\bc\+\+\b/i,
        /\bgo(?:lang)?\b/i,
        /\bgraphql\b/i,
        /\brest\s+apis?\b/i,
        /\bmicroservices?\b/i,
        /\bkafka\b/i,
        /\brabbitmq\b/i,
        /\bterraform\b/i,
        /\bgcp\b/i,
        /\bazure\b/i,
        /\bsql\b/i,
        /\bnosql\b/i,
        /\bdynamodb\b/i,
        /\belasticsearch\b/i,
        /\bnest(?:\.js|js)?\b/i,
        /\bexpress(?:\.js|js)?\b/i,
        /\bstripe\b/i,
    ];
    const found: string[] = [];
    const role = detectHeaderRole(buildTargetTitle(job));
    const addHeaderTech = (name: string) => {
        const supported = HEADER_STACK_ALLOWED.has(name)
            ? [name]
            : HEADER_STACK_ALTERNATIVES[name] ?? [];

        for (const tech of supported) {
            if (!isTechAllowedForRole(tech, role)) continue;

            if (!found.some((item) => item.toLowerCase() === tech.toLowerCase())) {
                found.push(tech);
            }
        }
    };

    for (const text of [job.title, job.description]) {
        for (const pattern of patterns) {
            const match = pattern.exec(text);
            if (!match) continue;

            const name = normalizeTechName(match[0]);
            addHeaderTech(name);
        }
    }

    const completed = completeHeaderStack(found, role);

    if (completed.length > 0) return completed.join(" | ");

    return completeHeaderStack(buildTargetTitle(job)
        .split("|")
        .slice(1)
        .map((part) => part.trim())
        .filter(Boolean)
        .map(normalizeTechName), role)
        .join(" | ");
}

function cleanAiMarkdown(content: string): string {
     // Remove markdown code fences if present
     content = content
         .replace(/^```(?:markdown|text|plain)?\s*/i, "")
         .replace(/\s*```$/i, "")
         .trim();
     
     // Clean up extra blank lines (keep max 2 consecutive)
     content = content
         .replace(/\n{3,}/g, "\n\n");
     
     // Ensure proper line endings
     return content;
 }

function hasCoverLetterGreeting(content: string): boolean {
    return /^(dear|hello|hi)\b/i.test(content.trim());
}

function hasCoverLetterSignature(content: string, fullName: string): boolean {
    const normalized = content.toLowerCase();
    const firstName = fullName.split(/\s+/)[0]?.toLowerCase();

    return (
        /\b(sincerely|best regards|kind regards|regards|thank you)\b/i.test(content) &&
        (normalized.includes(fullName.toLowerCase()) || Boolean(firstName && normalized.includes(firstName)))
    );
}

function ensureCoverLetterFormat(content: string, fullName: string): string {
    const blocks = content
        .replace(/\r/g, "")
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter(Boolean);

    let normalized = blocks.join("\n\n");

    if (!hasCoverLetterGreeting(normalized)) {
        normalized = `Dear Hiring Manager,\n\n${normalized}`;
    }

    if (!hasCoverLetterSignature(normalized, fullName)) {
        normalized = `${normalized.replace(/\s+$/g, "")}\n\nSincerely,\n${fullName}`;
    }

    return normalized;
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function normalizeSectionText(value: string): string {
    return value
        .replace(/^\s*\.\s*$/gm, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function buildResumeCode(title: string): string {
    const stopWords = new Set([
        "senior",
        "sr",
        "junior",
        "jr",
        "lead",
        "principal",
        "staff",
        "mid",
        "middle",
    ]);

    const words = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .split(/\s+/)
        .filter(Boolean)
        .filter((word) => !stopWords.has(word));

    const code = words.map((word) => word[0]?.toUpperCase()).join("");

    return code || "JOB";
}

function sanitizeFileNamePart(value: string): string {
    return value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function buildCandidateResumeBaseName(fullName: string, resumeCode: string): string {
    const nameParts = fullName
        .trim()
        .split(/\s+/)
        .map(sanitizeFileNamePart)
        .filter(Boolean);
    const firstName = nameParts[0] || "Candidate";
    const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : "User";

    return `CV_${firstName}_${lastName}_${resumeCode}`;
}

function buildSkillsXml(skills: string): string {
    const lines = normalizeSectionText(skills)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    const runs: string[] = [];

    for (const line of lines) {
        const match = /^([^:]+):\s*(.*)$/.exec(line);

        if (match) {
            const label = match[1].trim();
            const rest = match[2].trim();

            runs.push(
                `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t xml:space="preserve">${escapeXml(label)}</w:t></w:r>`,
            );

            runs.push(
                `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t xml:space="preserve">${escapeXml(`: ${rest}`)}</w:t></w:r>`,
            );
        } else {
            runs.push(`<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r>`);
        }

        runs.push(`<w:r><w:br/></w:r>`);
    }

    if (runs.length > 0) {
        runs.pop();
    }

    return `||${runs.join("")}||`;
}

function hasRealDescription(description: string): boolean {
     return description.trim().length >= 500;
 }

 function extractSection(content: string, section: string): string {
     // New format: section names followed by newline or no colon
     const sectionRegex = new RegExp(
         `^${section}\\s*$([\\s\\S]*?)(?=^[A-Z][A-Za-z\\s&/+-]+\\s*$|$)`,
         "im",
     );
     
     const match = sectionRegex.exec(content);
     if (match && match[1]) {
         return match[1].trim();
     }
     
     // Fallback to old format with regex
     const oldRegex = new RegExp(
         `(?:^|\\n)(?:#{1,3}\\s*)?${section}\\s*\\n([\\s\\S]*?)(?=\\n(?:#{1,3}\\s*)?[A-Z][A-Z /&+-]+\\s*\\n|$)`,
         "i",
     );
     
     return oldRegex.exec(content)?.[1]?.trim() ?? "";
 }

 function extractSummary(content: string): string {
     const explicit = extractSection(content, "SUMMARY");
     if (explicit) return explicit;

     const lines = content
         .split(/\r?\n/)
         .map((line) => line.trim())
         .filter(Boolean);
     const skillsIndex = lines.findIndex((line) => /^skills$/i.test(line));

     if (skillsIndex === -1) return "";

     for (let index = skillsIndex - 1; index >= 0; index--) {
         const line = lines[index];

         if (
             /^DMITRII BANK/i.test(line) ||
             /^phone:/i.test(line) ||
             /^email:/i.test(line) ||
             /linkedin\.com|github\.com/i.test(line) ||
             /hebrew|english|russian/i.test(line) ||
             /^[A-Za-z -]+Developer\s*\|/i.test(line)
         ) {
             continue;
         }

         if (line.length >= 80) return line;
     }

     return "";
 }

 function extractHeaderTitle(content: string): string {
     const lines = content
         .split(/\r?\n/)
         .map((line) => line.trim())
         .filter(Boolean);

     const nameIndex = lines.findIndex((line) => /^DMITRII BANK\b/i.test(line));

     if (nameIndex >= 0) {
         const titleLine = lines.slice(nameIndex + 1).find((line) =>
             !/^\+?\d|linkedin\.com|github\.com|@|hebrew|english|russian/i.test(line) &&
             /\b(developer|engineer)\b/i.test(line)
         );

         if (titleLine) return titleLine;
     }

     return lines.find((line) => /\b(developer|engineer)\b/i.test(line) && line.includes("|")) ?? "";
 }

 function getRoleFromTitle(title: string): string {
     return title.split("|")[0]?.trim() || "Full-stack Developer";
 }

function alignSummaryWithRole(summary: string, targetTitle: string): string {
    const role = getRoleFromTitle(targetTitle);
    const trimmed = normalizeSectionText(summary);

    if (!trimmed) return trimmed;

    const aligned = trimmed.replace(
        /^(Senior\s+)?(Full[-\s]?Stack|Backend|Frontend|Software|AI\s+Full[-\s]?Stack|Fullstack)\s+(Developer|Engineer)\b/i,
        role,
    );

    if (/backend/i.test(role)) {
        return aligned
            .replace(/,\s*React\b/gi, "")
            .replace(/\bReact,\s*/gi, "")
            .replace(/\s+and\s+React\b/gi, "")
            .replace(/,\s*Next\.js\b/gi, "")
            .replace(/\bNext\.js,\s*/gi, "")
            .replace(/\s+and\s+Next\.js\b/gi, "");
    }

    if (/frontend/i.test(role)) {
        return aligned
            .replace(/\bFull[-\s]?Stack\b/gi, "Frontend")
            .replace(/\bBackend\b/gi, "Frontend")
            .replace(/,\s*Node\.js\b/gi, "")
            .replace(/\bNode\.js,\s*/gi, "")
            .replace(/\s+and\s+Node\.js\b/gi, "")
            .replace(/,\s*AWS\b/gi, "")
            .replace(/\bAWS,\s*/gi, "")
            .replace(/\s+and\s+AWS\b/gi, "");
    }

    return aligned;
}

function repairMarkdownContent(content: string, title: string): string {
    const lines = content
        .replace(/\bnext-\b/gi, "Next.js")
        .replace(/\bnext js\b/gi, "Next.js")
        .split(/\r?\n/);
    const titleIndex = lines.findIndex((line, index) => {
        if (index > 8) return false;

        return /\b(Developer|Engineer|Lead)\b/i.test(line) && line.includes("|");
    });
    const languageIndex = lines.findIndex((line, index) => {
        if (index > 10) return false;

        return /\bHebrew\b/i.test(line) && /\bEnglish\b/i.test(line);
    });
    const summaryIndex = lines.findIndex((line, index) => {
        if (index <= languageIndex || index > 18) return false;

        return line.trim().length >= 80;
    });

    if (titleIndex !== -1) {
        lines[titleIndex] = title;
    }

    if (languageIndex !== -1) {
        const prefix = lines[languageIndex].match(/^\s*/)?.[0] ?? "";
        lines[languageIndex] = `${prefix}Languages: Hebrew, English, Russian`;
    }

    if (summaryIndex !== -1) {
        lines[summaryIndex] = alignSummaryWithRole(lines[summaryIndex], title);
    }

    return lines.join("\n").trimEnd();
}

function extractExperienceBullets(content: string, company: string): string {
     const lines = content.split(/\r?\n/);
     const companyIndex = lines.findIndex((line) => line.toLowerCase().includes(company.toLowerCase()));

     if (companyIndex === -1) return "";

     const bullets: string[] = [];

     for (const line of lines.slice(companyIndex + 1)) {
         const trimmed = line.trim();

         if (/^(Education|Experience|Skills|Languages|Projects)$/i.test(trimmed)) {
             break;
         }

         if (/^Technologies:/i.test(trimmed) && bullets.length > 0) {
             break;
         }

         if (
             bullets.length > 0 &&
             /\b(Inetex|VTA Center|AVSD\+)\b/i.test(trimmed) &&
             !trimmed.toLowerCase().includes(company.toLowerCase())
         ) {
             break;
         }

         if (/^[•*-]\s+/.test(trimmed)) {
             bullets.push(trimmed.replace(/^[•*-]\s+/, "• "));
         }
     }

     return bullets.join("\n");
 }

function extractTechnologiesLine(content: string, company: string): string {
     const lines = content.split(/\r?\n/);
     const companyIndex = lines.findIndex((line) => line.toLowerCase().includes(company.toLowerCase()));

     if (companyIndex === -1) return "";

     for (const line of lines.slice(companyIndex + 1)) {
         const trimmed = line.trim();

         if (
             /\b(Inetex|VTA Center|AVSD\+)\b/i.test(trimmed) &&
             !trimmed.toLowerCase().includes(company.toLowerCase())
         ) {
             break;
         }

         const match = /^Technologies:\s*(.*)$/i.exec(trimmed);
         if (match) return match[1].trim();
     }

     return "";
 }

 function sanitizeTechnologiesLine(technologies: string, role: ResumeRole): string {
     const frontendBlocked = new Set([
         "Node.js",
         "Express.js",
         "NestJS",
         "PostgreSQL",
         "MongoDB",
         "Prisma",
         "Redis",
         "AWS",
         "AWS Lambda",
         "AWS SQS",
         "SQS",
         "SNS",
         "DynamoDB",
         "Docker",
         "Docker Compose",
         "Kubernetes",
         "Microservices",
         "Zod",
         "Kafka",
         "RabbitMQ",
         "PostGIS",
     ]);
     const unsupported = new Set(["PostGIS", "RabbitMQ", "Firebase"]);
     const backendBlocked = new Set([
         "React",
         "Next.js",
         "Redux",
         "Redux Toolkit",
         "Material UI",
         "Bootstrap",
         "Firebase",
         "Responsive UI",
         "Component Architecture",
     ]);
     const blocked = role === "frontend"
         ? frontendBlocked
         : role === "backend"
             ? backendBlocked
             : new Set<string>();

     return technologies
         .split(",")
         .map((tech) => tech.trim())
         .filter(Boolean)
         .filter((tech) => !unsupported.has(tech))
         .filter((tech) => !blocked.has(tech))
         .filter((tech, index, list) =>
             list.findIndex((item) => item.toLowerCase() === tech.toLowerCase()) === index
         )
         .join(", ");
 }

 function buildFallbackTechnologies(company: "Inetex" | "VTA Center" | "AVSD+", role: ResumeRole): string {
     const byRole: Record<ResumeRole, Record<typeof company, string>> = {
         backend: {
             Inetex: "Node.js, TypeScript, Express.js, PostgreSQL, Prisma, Redis, DynamoDB, AWS Lambda, SQS, SNS, Kafka, Stripe Webhooks, JWT, RBAC, Zod, Helmet, CORS, Rate Limiting, Winston, Swagger/OpenAPI, Docker, Docker Compose, Kubernetes, LocalStack, Jest, Supertest, Claude Code, Cursor AI, GitHub Copilot, OpenAI Codex",
             "VTA Center": "Node.js, TypeScript, Express.js, MongoDB, Mongoose, JWT, Passport Google OAuth, Zod, Helmet, CORS, Rate Limiting, HPP, Mongo Sanitize, Winston, Nodemailer, Swagger UI, Docker, Docker Compose, Jest, Supertest",
             "AVSD+": "JavaScript, React, REST API",
         },
         frontend: {
             Inetex: "React 18, TypeScript, Vite, Material UI, MUI Data Grid, React Router, Zustand, TanStack React Query, Axios, Google OAuth, REST API, JWT, Leaflet, Jest, Testing Library, ESLint, Claude Code, Cursor AI, GitHub Copilot, OpenAI Codex",
             "VTA Center": "React, TypeScript, Vite, Redux Toolkit, React Redux, Redux Persist, React Router, Material UI, MUI Data Grid, React PDF, Google OAuth, REST API, JWT, Jest, ESLint",
             "AVSD+": "JavaScript, React, REST API, Material UI, Bootstrap",
         },
         fullstack: {
             Inetex: "React 18, TypeScript, Vite, Material UI, Zustand, TanStack React Query, Axios, Node.js, Express.js, PostgreSQL, Prisma, Redis, DynamoDB, AWS Lambda, SQS, SNS, Kafka, Stripe Webhooks, JWT, RBAC, Zod, Docker, Docker Compose, Kubernetes, LocalStack, Jest, Supertest, Claude Code, Cursor AI, GitHub Copilot, OpenAI Codex",
             "VTA Center": "React, TypeScript, Vite, Redux Toolkit, Material UI, Node.js, Express.js, MongoDB, Mongoose, JWT, Passport Google OAuth, Zod, Docker, Docker Compose, Jest, Supertest",
             "AVSD+": "JavaScript, React, REST API, Material UI, Bootstrap",
         },
     };

     return byRole[role][company];
 }

 function buildTemplateTechnologies(
     content: string,
     company: "Inetex" | "VTA Center" | "AVSD+",
     role: ResumeRole,
     targetStack: string,
 ): string {
     const extracted = sanitizeTechnologiesLine(extractTechnologiesLine(content, company), role);

     let technologies = extracted || buildFallbackTechnologies(company, role);

     if (company === "VTA Center" && /\bNestJS\b/i.test(targetStack) && role !== "frontend" && !technologies.includes("NestJS")) {
         technologies = technologies.replace("Express.js", "Express.js, NestJS");
     }

     if (company === "VTA Center" && /\bNext\.js\b/i.test(targetStack) && role !== "backend" && !technologies.includes("Next.js")) {
         technologies = technologies.replace("Vite", "Vite, Next.js");
     }

     return technologies;
 }

 function detectJobCategory(title: string, description: string): string {
     const text = `${title} ${description}`.toLowerCase();

     if (/(llm|gpt|claude|gpt-4|ai model|ai-assistant|prompt|generative|ai agent)/i.test(text)) {
         return "AI";
     }
     if (/(fintech|payment|blockchain|crypto|transaction|settlement|compliance|aml|kyc)/i.test(text)) {
         return "FINTECH";
     }
     if (/(saas|product|customer|growth|ods|upsell)/i.test(text)) {
         return "SAAS";
     }
     if (/(data|analytics|datalake|reporting|warehouse|etl|bi)/i.test(text)) {
         return "DATA";
     }
     if (/(devops|infrastructure|kubernetes|docker|terraform|ci\/cd|deployment|scaling)/i.test(text)) {
         return "DEVOPS";
     }
     if (/(microservice|distributed|scalable|high availability|reliability)/i.test(text)) {
         return "BACKEND";
     }
     if (/(react|vue|angular|frontend|ui|ux|web|responsive)/i.test(text)) {
         return "FRONTEND";
     }

     // Default: check if backend-heavy or full-stack
     const backendKeywords = [
         "node.js", "nodejs", "backend", "api", "database", "server", "aws",
         "docker", "microservice", "kafka", "redis", "postgresql", "mongodb"
     ];
     const frontendKeywords = ["react", "frontend", "ui", "component", "javascript"];

     const backendCount = backendKeywords.filter(kw => text.includes(kw)).length;
     const frontendCount = frontendKeywords.filter(kw => text.includes(kw)).length;

     return backendCount > frontendCount ? "BACKEND" : "FULLSTACK";
 }

 function buildSkillsForJob(role: ResumeRole, jobCategory: string, targetStack: string): string {
     const skillsByRole: Record<ResumeRole, string> = {
         backend: `Languages: TypeScript, JavaScript, SQL, Python, Java
Backend: Node.js, Express.js, REST API, JWT, RBAC, Zod, Stripe Webhooks, Swagger/OpenAPI
Cloud & Async: AWS Lambda, SQS, SNS, DynamoDB, AWS SDK, Kafka, Event-Driven Workflows
Databases & Cache: PostgreSQL, Prisma, Redis, MongoDB, Mongoose, DynamoDB
Security & Reliability: Helmet, CORS, Rate Limiting, Request Validation, Audit Logging, Winston Logging
Infrastructure & Testing: Docker, Docker Compose, Kubernetes, LocalStack, Jest, Supertest
Tools: Git, GitHub Actions, Postman, ESLint
AI-Assisted Development: Claude Code, Cursor AI, GitHub Copilot, OpenAI Codex`,
         frontend: `Languages: TypeScript, JavaScript, SQL
Frontend: React, Vite, Material UI, MUI Data Grid, React Router, Zustand, Redux Toolkit
API Integration: REST API, Axios, TanStack React Query, JWT, Google OAuth, Role-Based Routes
UI & Product: Responsive UI, Form Validation, Admin Interfaces, Operator/User Workflows, Leaflet
Quality: Jest, Testing Library, ESLint, TypeScript Build, Performance/Bundle Awareness
Tools: Git, GitHub Actions, Postman
AI-Assisted Development: Claude Code, Cursor AI, GitHub Copilot, OpenAI Codex`,
         fullstack: CANONICAL_SKILLS,
     };

     let skills = skillsByRole[role];

     if (/\bNestJS\b/i.test(targetStack) && role !== "frontend" && !skills.includes("NestJS")) {
         skills = skills.replace("Express.js", "Express.js, NestJS");
     }

     if (/\bNext\.js\b/i.test(targetStack) && role !== "backend" && !skills.includes("Next.js")) {
         skills = skills.replace("React, TypeScript, Vite", "React, TypeScript, Vite, Next.js");
         skills = skills.replace("React, Vite", "React, Vite, Next.js");
     }

     if (jobCategory === "AI" && role === "backend" && !skills.includes("AI-Assisted Development:")) {
         return `${skills}
AI-Assisted Development: Claude Code, Cursor AI, GitHub Copilot, OpenAI Codex`;
     }

     return skills;
 }

 function buildRoleBoundaries(role: ResumeRole): string {
     const boundaries: Record<ResumeRole, string> = {
         backend: `
ROLE BOUNDARY FOR BACKEND:
- Skills must prioritize Backend, Cloud & Infrastructure, Databases, Security, and Engineering.
- Summary must call the candidate Backend Developer/Engineer, not Frontend or Full-stack.
- Inetex and VTA bullets should emphasize APIs, services, databases, AWS, reliability, architecture, production support, and integrations.
- AVSD+ may stay as Frontend Developer, but keep it short and do not make it the main selling point.
- Technologies lines for backend-focused jobs must not lead with React/Next.js and must not imply frontend ownership unless that job entry actually used it.
- If the vacancy asks for technologies outside the candidate stack, mention adjacent supported technologies only from the skills block; do not add unsupported tools.`,
         frontend: `
ROLE BOUNDARY FOR FRONTEND:
- Skills must prioritize React, TypeScript, UI/component architecture, state management, API integration, performance, accessibility, and testing.
- Summary must call the candidate Frontend Developer/Engineer, not Backend or Full-stack.
- AVSD+ bullets should carry the strongest frontend evidence: customer-facing UI, responsive web apps, API integration, performance, maintainability.
- Inetex and VTA bullets may mention frontend/product UI work only where supported by the original resume; do not describe them as backend-heavy accomplishments.
- Technologies lines for frontend-focused jobs must not include backend/cloud/databases unless they are explicitly relevant to the specific entry and not presented as the frontend role's core.
- Do not use backend terms like microservices, AWS Lambda, DynamoDB, SQS, SNS, Kubernetes, or database modeling as the main pitch for a frontend vacancy.`,
         fullstack: `
ROLE BOUNDARY FOR FULLSTACK:
- Balance backend and frontend only when the vacancy is truly full-stack.
- Skills should summarize both Frontend and Backend capabilities, including AI-Assisted Development.
- Shift the summary and first experience bullets toward frontend when the vacancy emphasizes React, TypeScript, Vite, Material UI, routing, state, UI workflows, or REST API integration.
- Shift the summary and first experience bullets toward backend when the vacancy emphasizes Node.js, Express.js, PostgreSQL, Prisma, Redis, DynamoDB, AWS Lambda, SQS, Kafka, Kubernetes, Stripe webhooks, security, logging, or reliability.
- Experience bullets should show end-to-end ownership without claiming unsupported technologies.
- Technologies lines should include only technologies from the candidate profile and only where they fit the specific company/project.`,
     };

     return boundaries[role];
 }

 function extractKeywords(description: string): string[] {
     const techKeywords = [
         "node.js", "nodejs", "typescript", "javascript", "react", "aws", "docker",
         "kubernetes", "postgresql", "mongodb", "redis", "microservice", "restapi",
         "graphql", "agg", "fastapi", "express", "nest", "python", "java", "go",
         "rust", "c++", "sql", "nosql", "dynamodb", "elasticsearch", "kafka", "rabbitmq",
         "aws lambda", "aws s3", "aws ec2", "aws rds", "aws sqs", "aws sns",
         "gcp", "azure", "terraform", "ansible", "jenkins", "gitlab", "github",
         "git", "linux", "unix", "ssl", "tls", "oauth", "jwt", "rbac",
         "rest", "graphql", "grpc", "soap", "websocket", "http2", "http3",
         "Load balancing", "cdn", "caching", "nginx", "apache",
         "monitoring", "datadog", "newrelic", "prometheus", "grafana",
         "testing", "jest", "mocha", "pytest", "junit", "selenium",
         "scrum", "agile", "kanban", "jira", "gitlab", "github"
     ];

     const text = description.toLowerCase();
     return techKeywords
         .filter(keyword => text.includes(keyword))
         .map(kw => kw.toUpperCase());
 }

 function buildResumeTailoringStrategy(jobCategory: string, title: string, description: string): string {
     const strategies: Record<string, string> = {
         AI: `
 FOR AI-FOCUSED ROLE:
 1. Emphasize AI-assisted development (Claude, Cursor, GitHub Copilot, OpenAI experience)
 2. Highlight LLM familiarity and prompt engineering if applicable
 3. Focus on Cloud infrastructure that supports AI models
 4. Mention any experience with AI workflows, automation, or agent-based systems
 5. Emphasize scalability and deployment of AI solutions
 6. Reorder skills to prioritize: LLM Tools → Cloud (AWS) → Backend (Node.js) → Databases
 7. In bullet points, use terms from job like: "LLM", "API integration", "model deployment"
         `,
         FINTECH: `
 FOR FINTECH ROLE:
 1. Emphasize secure API design, authentication, authorization, validation, logging, and payment flow integration
 2. Highlight REST APIs, Stripe webhook handling, and reliable booking/payment state transitions when supported by project experience
 3. Focus on reliability, auditability, error handling, and production readiness
 4. Mention async command processing and event-driven workflows only where supported by project experience
 5. Emphasize Scalability and performance under load
 6. Reorder skills to prioritize: Security → APIs → Cloud (AWS) → Backend → Databases
 7. Use terms: "secure", "payment flow", "webhook", "reliable", "audit log", "validation"; do not claim PCI compliance
         `,
         SAAS: `
 FOR SAAS ROLE:
 1. Emphasize End-to-End Ownership and full product development
 2. Highlight Customer impact and metrics (MAU, retention, growth)
 3. Focus on Product development, feature delivery, iteration
 4. Mention fast delivery, MVP mindset, rapid iteration
 5. Emphasize User feedback loop and feature prioritization
 6. Reorder skills to prioritize: Product → Ownership → Backend → Frontend → Cloud
 7. Use terms: "owned", "shipped", "customer", "product", "feature", "impact"
         `,
         DATA: `
 FOR DATA/ANALYTICS ROLE:
 1. Emphasize Data Platforms and data pipeline experience
 2. Highlight Reporting and business analytics skills
 3. Focus on Data workflows, ETL, data quality
 4. Mention scale (volume of data, number of queries)
 5. Emphasize Business metrics and KPI tracking
 6. Reorder skills to prioritize: Data Platforms → Analytics → Backend → Databases
 7. Use terms: "data pipeline", "reporting", "analytics", "warehouse", "etl"
         `,
         DEVOPS: `
 FOR DEVOPS ROLE:
 1. Emphasize Docker, Docker Compose, LocalStack, environment setup, and deployment support
 2. Highlight CI/CD pipelines, deployment automation
 3. Focus on Monitoring, logging, observability
 4. Mention scaling, load balancing, disaster recovery
 5. Emphasize Reliability and uptime
 6. Reorder skills to prioritize: DevOps Tools → Cloud → Backend → Scripting
 7. Use terms: "infrastructure", "automation", "deployment", "scaling", "reliability"
         `,
         BACKEND: `
 FOR BACKEND ROLE:
 1. Emphasize Architecture and system design
 2. Highlight Scalability, microservices, distributed systems
 3. Focus on APIs (REST, GraphQL, gRPC)
 4. Mention Databases (PostgreSQL, MongoDB, Redis, DynamoDB)
 5. Emphasize Performance and optimization
 6. Reorder skills to prioritize: Backend → Cloud (AWS) → Databases → Microservices → APIs
 7. Use terms: "architecture", "scalable", "microservice", "api", "database"
         `,
         FRONTEND: `
 FOR FRONTEND ROLE:
 1. Emphasize React and component architecture
 2. Highlight Performance, responsive design, UX
 3. Focus on State management, testing, accessibility
 4. Mention Browser APIs, DOM optimization
 5. Emphasize User experience and visual polish
 6. Reorder skills to prioritize: React → Frontend → Backend → Cloud
 7. Use terms: "component", "responsive", "performance", "accessible", "ux"
         `,
         FULLSTACK: `
 FOR FULLSTACK ROLE:
 1. Balance Backend (60%) and Frontend (40%)
 2. Emphasize Full-stack ownership from DB to UI
 3. Highlight both Node.js/Backend and React/Frontend
 4. Focus on End-to-end feature delivery
 5. Mention Full product understanding
 6. Reorder skills: Backend → Frontend → Cloud → Databases
 7. Use terms: "full-stack", "end-to-end", "feature", "delivery", "ownership"
         `,
     };

     return strategies[jobCategory] || strategies.BACKEND;
 }

type GenerationOptions = {
    userId?: string;
    resumeBaseId?: string;
};

export async function generateResumeForJob(jobId: string, options: GenerationOptions = {}) {
     if (!options.userId) {
         throw new Error("userId is required for resume generation");
     }

     const job = await prisma.job.findUnique({
         where: { id: jobId },
     });

     if (!job) {
         throw new Error("Job not found");
     }

     if (!hasRealDescription(job.description)) {
         throw new Error(
             `Job description is too short for reliable resume generation. Job: ${job.title} | ${job.company ?? "Unknown"}`,
         );
     }

     await assertUserLimit(options.userId, "RESUME_GENERATED");
     await assertUserLimit(options.userId, "OPENAI_TOKENS");

     const profile = await getWorkspaceCandidateProfile(options.userId, options.resumeBaseId);

     if (!profile) {
         throw new Error("Candidate profile not found for this user.");
     }

     const targetTitle = buildTargetTitle(job);
     const targetStack = buildTargetStack(job);
     const targetRole = detectHeaderRole(targetTitle);
     const jobCategory = detectJobCategory(job.title, job.description);
     const skillsBlock = buildSkillsForJob(targetRole, jobCategory, targetStack);
     const roleBoundaries = buildRoleBoundaries(targetRole);
     const keywords = extractKeywords(job.description);
     const strategy = buildResumeTailoringStrategy(jobCategory, job.title, job.description);

     const prompt = `
 You are an expert ATS resume optimizer, technical recruiter, and career consultant for backend, frontend, and full-stack developers in Israel.

 CANDIDATE PROFILE:
 ${profile.resume}

 TARGET JOB:
 Title: ${job.title}
 Category: ${jobCategory}
 Role focus: ${targetRole}
 Company: ${job.company ?? "Unknown"}
 Location: ${job.location ?? "Unknown"}

 JOB DESCRIPTION:
 ${job.description}

 KEY REQUIREMENTS TO MATCH:
 ${keywords.join(", ")}

 ROLE ADAPTATION STRATEGY:
 ${strategy}

 ROLE-SPECIFIC BOUNDARIES:
 ${roleBoundaries}

 DETAILED INSTRUCTIONS:

 # CRITICAL: Resume Format
 The resume MUST follow this exact format:
 - Header line: NAME (two tabs) LOCATION
 - Title line: Professional title | Key technologies
 - Contact line: Phone (two tabs) LinkedIn
 - Email line: Email (two tabs) GitHub  
 - Languages line (indented)
 - Blank line
 - Summary paragraph (full width, not sectioned)
 - Blank line
 - Skills section (header, then subsections like "Languages:", "Frontend:", "Backend:", etc.)
 - Blank line
 - Experience section (company, project description, bullets, technologies line)
 - Education section

 # Core Rules (NON-NEGOTIABLE):
 1. ✅ Keep resume structure and section order IDENTICAL to original.
 2. ✅ Keep all personal contact details UNCHANGED (name, phone, email, LinkedIn, GitHub, location).
 3. ✅ Replace the professional title line (line 2) with: "${targetTitle}"
 4. ✅ DO NOT invent companies, dates, education, or fake experience.
 5. ✅ DO NOT add technologies unless already in the original resume or clearly supported by experience.
 6. ✅ Preserve all real career history and factual accuracy.
 7. ✅ Return only the tailored resume in plain text format, no markdown code fences or backquotes.
 8. ✅ Maintain consistent formatting with tabs and line breaks exactly as in original.
 9. ✅ All Skills and Technologies must come from the candidate stack below. If the job asks for a missing tool, do not invent it; emphasize the closest real technology from the candidate stack.
 10. ✅ Do not claim PCI compliance, RabbitMQ, Firebase, Terraform, or unsupported technologies.
 11. ✅ Kubernetes and Kafka are supported for the Inetex smart locker backend/full-stack experience and may be used for backend/full-stack resumes when relevant.
 12. ✅ NestJS may be used for VTA backend only when the target vacancy explicitly requires NestJS; Next.js may be used for VTA frontend only when the target vacancy explicitly requires Next.js.

 # Optimization Strategy:
 1. Rewrite SUMMARY paragraph to emphasize job keywords and role type (${jobCategory})
    - The first words of SUMMARY must match the target role from the title line: "${getRoleFromTitle(targetTitle)}"
    - If the target role is Backend, do not call the candidate Full-Stack in SUMMARY
    - If the target role is Frontend, do not call the candidate Full-Stack or Backend in SUMMARY
    - Lead with relevant years and technologies from requirements
    - Highlight accomplishments matching role type
    - Use exact terminology and phrases from job description
    - Keep paragraph format (not bullet points)
 2. Replace SKILLS with the exact role-focused skills block below:
${skillsBlock}
 3. Keep technologies within each skills subsection exactly as listed above
 4. Rewrite EXPERIENCE bullets to:
    - Lead with job-relevant accomplishments
    - Include quantifiable metrics where possible  
    - Highlight only relevant technologies from the candidate stack
    - Use action verbs matching role type
    - For frontend roles, emphasize UI, React, components, state, API integration, performance, responsiveness, and UX; do not frame backend architecture as the main work.
    - For backend roles, emphasize APIs, services, data models, cloud workflows, reliability, scalability, security, production support, and integrations; do not frame frontend UI as the main work.
    - For full-stack roles, connect backend and frontend only where both are relevant to the vacancy.
 5. Keep company names, dates, and project descriptions unchanged
 6. Update each "Technologies:" line to match the role focus and the actual work for that company:
    - Use only technologies present in the original candidate resume or in the role-focused skills block above.
    - Do not put backend/cloud/database technologies into a frontend-only job entry unless the original entry genuinely used them.
    - Do not put frontend technologies into a backend-only job entry unless the original entry genuinely used them.
    - Do not copy every requirement from the vacancy; select the technologies that are both relevant and truthful.

 # Category-Specific Emphasis:
 ${strategy}

 # Resume Quality Checks:
 ✓ Read naturally (not keyword-stuffed)
 ✓ Matches ATS scanner patterns (consistent formatting, clear sections)
 ✓ Highlights real relevant experience
 ✓ Maintains professional tone
 ✓ No contradictions or fabrications
 ✓ Flows logically from summary → experience → education
 ✓ Uses exact formatting from example with tabs and line breaks

 OUTPUT:
 Generate the COMPLETE tailored resume using the original profile template as structural guide.
 Use tabs for alignment where shown in examples (between name/location, phone/LinkedIn, etc).
 Keep the same format structure - do NOT add markdown, do NOT use headers with #, do NOT use code blocks.
 `;

     const response = await getOpenAIClient().chat.completions.create({
         model: MODEL,
         messages: [
             {
                 role: "user",
                 content: prompt,
             },
         ],
     });

     if (response.usage?.total_tokens) {
         await recordUsageEvent(options.userId, "OPENAI_TOKENS", response.usage.total_tokens, {
             scope: "resume_generation",
             jobId,
             model: MODEL,
         });
     }

     const rawContent = response.choices[0]?.message?.content;

     if (!rawContent) {
         throw new Error("Empty resume generation response");
     }

     const content = cleanAiMarkdown(rawContent);
     const cleanContent = normalizeSectionText(content);

     const folderName = slugify(`${job.company ?? "unknown"}-${job.title}`);
     const resumeFolder = `resumes/${options.userId}/${folderName}`;
     const resumeCode = buildResumeCode(job.title);
     const resumeBaseName = buildCandidateResumeBaseName(profile.fullName, resumeCode);
     const finalTitle = `${(extractHeaderTitle(cleanContent) || targetTitle).split("|")[0].trim()} | ${targetStack}`;
     const repairedMarkdown = repairMarkdownContent(cleanContent, finalTitle);

     await saveTextFile(resumeFolder, `${resumeBaseName}.md`, repairedMarkdown);

     const docxPath = path.join(
         getStorageRoot(),
         resumeFolder,
         `${resumeBaseName}.docx`,
     );
     const pdfPath = path.join(
         getStorageRoot(),
         resumeFolder,
         `${resumeBaseName}.pdf`,
     );
	     const templateData = {
	         FULL_NAME: profile.fullName,
	         LOCATION: profile.location ?? "",
	         PHONE: profile.phone ?? "",
	         LINKEDIN: profile.linkedin ?? "",
	         EMAIL: profile.email,
	         GITHUB: profile.github ?? "",
	         LANGUAGES: profile.languages?.join(", ") ?? "",
	         TITLE: finalTitle,
	         SUMMARY: alignSummaryWithRole(extractSummary(cleanContent), targetTitle),
         SKILLS: skillsBlock,
         INETEX_BULLETS: extractExperienceBullets(cleanContent, "Inetex"),
         INETEX_TECHNOLOGIES: buildTemplateTechnologies(cleanContent, "Inetex", targetRole, targetStack),
         VTA_BULLETS: extractExperienceBullets(cleanContent, "VTA Center"),
         VTA_TECHNOLOGIES: buildTemplateTechnologies(cleanContent, "VTA Center", targetRole, targetStack),
         AVSD_BULLETS: extractExperienceBullets(cleanContent, "AVSD+"),
         AVSD_TECHNOLOGIES: buildTemplateTechnologies(cleanContent, "AVSD+", targetRole, targetStack),
     };

     await createResumeFromTemplate(
         templateData,
         docxPath,
     );
     const pdfFilePath = await createResumePdfFromTemplate(templateData, pdfPath).catch((error) => {
         console.error("[Resume Generator] PDF generation failed:", error);
         return null;
     });

     const resumeVersion = await prisma.resumeVersion.create({
         data: {
             jobId: job.id,
             userId: options.userId,
             content: cleanContent,
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

     return {
         ...resumeVersion,
         pdfFilePath,
     };
 }

export async function generateCoverLetterForJob(jobId: string, options: GenerationOptions = {}) {
    if (!options.userId) {
        throw new Error("userId is required for cover letter generation");
    }

    const job = await prisma.job.findUnique({
        where: { id: jobId },
    });

    if (!job) {
        throw new Error("Job not found");
    }

    if (!hasRealDescription(job.description)) {
        throw new Error(
            `Job description is too short for reliable cover letter generation. Job: ${job.title} | ${job.company ?? "Unknown"}`,
        );
    }

    await assertUserLimit(options.userId, "OPENAI_TOKENS");

    const profile = await getWorkspaceCandidateProfile(options.userId, options.resumeBaseId);

    if (!profile) {
        throw new Error("Candidate profile not found for this user.");
    }

    const targetTitle = buildTargetTitle(job);

    const prompt = `
You are a senior technical recruiter.

Write a concise professional cover letter for this job.

Candidate target title:
${targetTitle}

Candidate resume:
${profile.resume}

Job:
Title: ${job.title}
Company: ${job.company ?? "Unknown"}
Location: ${job.location ?? "Unknown"}

Description:
${job.description}

Rules:
- Maximum 180 words.
- Professional tone.
- Start with a greeting, preferably "Dear Hiring Manager," unless a recruiter name is clearly available.
- End with a professional sign-off and the candidate name: ${profile.fullName}.
- Mention relevant Node.js, TypeScript, AWS, React, backend, frontend, or full-stack experience only when relevant to the job.
- Do not invent facts.
- Do not call the candidate Senior unless the target title includes Senior.
- Return only the cover letter text, with paragraphs separated by blank lines.
`;

    const response = await getOpenAIClient().chat.completions.create({
        model: MODEL,
        messages: [
            {
                role: "user",
                content: prompt,
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

    if (!rawContent) {
        throw new Error("Empty cover letter generation response");
    }

    const content = ensureCoverLetterFormat(cleanAiMarkdown(rawContent), profile.fullName);

    const folderName = slugify(
        `${job.company ?? "unknown"}-${job.title}`,
    );
    const folder = `resumes/${options.userId}/${folderName}`;
    const dir = path.join(getStorageRoot(), folder);
    const docxPath = path.join(dir, "cover-letter.docx");

    await ensureDir(dir);
    await createCoverLetterDocx(content, docxPath);

    await saveTextFile(
        folder,
        "cover-letter.txt",
        content,
    );

    return prisma.coverLetter.create({
        data: {
            jobId: job.id,
            userId: options.userId,
            content,
            filePath: docxPath,
        },
    });
}

export async function generateApplicationPackageForJob(jobId: string, options: GenerationOptions = {}) {
    const resume = await generateResumeForJob(jobId, options);
    const coverLetter = await generateCoverLetterForJob(jobId, options);

    return {
        resume,
        coverLetter,
    };
}
