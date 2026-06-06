import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import fs from "fs/promises";
import path from "path";
import { createResumePdfFromTemplate } from "../services/resume-pdf.service";
import { createResumeFromTemplate } from "../services/template-docx.service";

const prisma = new PrismaClient();

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

function detectHeaderRole(title: string): keyof typeof HEADER_STACK_DEFAULTS {
    const lower = title.toLowerCase();

    if (/(frontend|front-end)/i.test(lower) && !/(full[\s-]?stack|fullstack|backend|back-end)/i.test(lower)) {
        return "frontend";
    }

    if (/(backend|back-end)/i.test(lower) && !/(full[\s-]?stack|fullstack|frontend|front-end)/i.test(lower)) {
        return "backend";
    }

    return "fullstack";
}

function isTechAllowedForRole(tech: string, role: keyof typeof HEADER_STACK_DEFAULTS): boolean {
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
    role: keyof typeof HEADER_STACK_DEFAULTS,
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

function buildSkillsXml(skills: string): string {
    const lines = normalizeSectionText(skills)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    const runs: string[] = [];

    for (const line of lines) {
        const match = /^([^:]+):\s*(.*)$/.exec(line);

        if (match) {
            runs.push(`<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t xml:space="preserve">${escapeXml(match[1].trim())}</w:t></w:r>`);
            runs.push(`<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t xml:space="preserve">${escapeXml(`: ${match[2].trim()}`)}</w:t></w:r>`);
        } else {
            runs.push(`<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r>`);
        }

        runs.push("<w:r><w:br/></w:r>");
    }

    if (runs.length > 0) runs.pop();

    return `||${runs.join("")}||`;
}

function buildSkillsForTitle(title: string): string {
    const role = detectHeaderRole(title);
    const skillsByRole: Record<keyof typeof HEADER_STACK_DEFAULTS, string> = {
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

    if (/\bNestJS\b/i.test(title) && role !== "frontend" && !skills.includes("NestJS")) {
        skills = skills.replace("Express.js", "Express.js, NestJS");
    }

    if (/\bNext\.js\b/i.test(title) && role !== "backend" && !skills.includes("Next.js")) {
        skills = skills.replace("React, TypeScript, Vite", "React, TypeScript, Vite, Next.js");
        skills = skills.replace("React, Vite", "React, Vite, Next.js");
    }

    return skills;
}

function extractSummary(content: string): string {
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

    return lines.find((line) => /\b(developer|engineer)\b/i.test(line) && line.includes("|")) ?? "Full-stack Developer";
}

function getRoleFromTitle(title: string): string {
    return title.split("|")[0]?.trim() || "Full-stack Developer";
}

function alignSummaryWithRole(summary: string, title: string): string {
    const role = getRoleFromTitle(title);
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

function buildStackFromVacancy(title: string, description: string): string {
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
    const role = detectHeaderRole(title);
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

    for (const text of [title, description]) {
        for (const pattern of patterns) {
            const match = pattern.exec(text);
            if (!match) continue;

            const name = normalizeTechName(match[0]);
            addHeaderTech(name);
        }
    }

    return completeHeaderStack(found, role).join(" | ");
}

function sanitizeHeaderStack(stack: string, role: keyof typeof HEADER_STACK_DEFAULTS): string {
    const found: string[] = [];

    for (const part of stack.split("|")) {
        const name = normalizeTechName(part);
        const supported = HEADER_STACK_ALLOWED.has(name)
            ? [name]
            : HEADER_STACK_ALTERNATIVES[name] ?? [];

        for (const tech of supported) {
            if (!isTechAllowedForRole(tech, role)) continue;

            if (!found.some((item) => item.toLowerCase() === tech.toLowerCase())) {
                found.push(tech);
            }
        }
    }

    return completeHeaderStack(found, role).join(" | ");
}

async function buildHeaderTitleForDocx(content: string, docxPath: string): Promise<string> {
    const headerTitle = extractHeaderTitle(content);
    const role = headerTitle.split("|")[0]?.trim() || "Full-stack Developer";
    const roleType = detectHeaderRole(role);
    const existingStack = sanitizeHeaderStack(headerTitle.split("|").slice(1).map((part) => part.trim()).filter(Boolean).join(" | "), roleType);
    const relativePath = path.relative(process.cwd(), docxPath);
    const resumeVersion = await prisma.resumeVersion.findFirst({
        where: {
            OR: [
                { filePath: docxPath },
                { filePath: relativePath },
            ],
        },
        include: { job: true },
        orderBy: { createdAt: "desc" },
    });
    const vacancyStack = resumeVersion?.job
        ? buildStackFromVacancy(resumeVersion.job.title, resumeVersion.job.description)
        : "";
    const alignedVacancyStack = vacancyStack ? sanitizeHeaderStack(vacancyStack, roleType) : "";
    const fallbackStack = HEADER_STACK_DEFAULTS[roleType].join(" | ");

    return `${role} | ${alignedVacancyStack || existingStack || fallbackStack}`;
}

function extractExperienceBullets(content: string, company: string): string {
    const lines = content.split(/\r?\n/);
    const companyIndex = lines.findIndex((line) => line.toLowerCase().includes(company.toLowerCase()));

    if (companyIndex === -1) return "";

    const bullets: string[] = [];

    for (const line of lines.slice(companyIndex + 1)) {
        const trimmed = line.trim();

        if (/^(Education|Experience|Skills|Languages|Technologies)$/i.test(trimmed)) {
            break;
        }

        if (/^Technologies:/i.test(trimmed) && bullets.length > 0) break;

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

function fallbackTechnologies(company: "Inetex" | "VTA Center" | "AVSD+"): string {
    const technologies: Record<keyof typeof HEADER_STACK_DEFAULTS, Record<typeof company, string>> = {
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

    return technologies.fullstack[company];
}

function sanitizeTechnologiesLine(technologies: string, role: keyof typeof HEADER_STACK_DEFAULTS): string {
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

function roleFallbackTechnologies(company: "Inetex" | "VTA Center" | "AVSD+", role: keyof typeof HEADER_STACK_DEFAULTS): string {
    const technologies: Record<keyof typeof HEADER_STACK_DEFAULTS, Record<typeof company, string>> = {
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

    return technologies[role][company];
}

function templateTechnologies(content: string, company: "Inetex" | "VTA Center" | "AVSD+", title: string): string {
    const role = detectHeaderRole(title);
    let technologies = roleFallbackTechnologies(company, role) || fallbackTechnologies(company);

    if (company === "VTA Center" && /\bNestJS\b/i.test(title) && role !== "frontend" && !technologies.includes("NestJS")) {
        technologies = technologies.replace("Express.js", "Express.js, NestJS");
    }

    if (company === "VTA Center" && /\bNext\.js\b/i.test(title) && role !== "backend" && !technologies.includes("Next.js")) {
        technologies = technologies.replace("Vite", "Vite, Next.js");
    }

    return technologies;
}

function fallbackSummary(title: string): string {
    const role = detectHeaderRole(title);

    if (role === "frontend") {
        return "Frontend Developer with 5+ years of experience building production web applications and customer-facing workflows with React, TypeScript, Vite, Material UI, REST API integration, authentication flows, and role-based interfaces. Experienced in developing booking, locker management, educational assessment, admin, operator, and user-facing screens while collaborating with backend, product, and QA teams. Strong focus on maintainable components, reliable API integration, responsive UI, validation states, error handling, testing, and production-ready delivery.";
    }

    if (role === "backend") {
        return "Backend Developer with 5+ years of experience building production REST APIs, authentication flows, role-based access control, booking and assessment workflows, async processing, and persistence layers using Node.js, TypeScript, Express.js, PostgreSQL, Prisma, Redis, DynamoDB, MongoDB, Mongoose, AWS Lambda, SQS, Stripe webhooks, Docker, and Jest/Supertest. Strong focus on secure API design, validation, logging, documentation, reliability, maintainability, and collaboration with frontend, product, QA, and support teams.";
    }

    return "Full-Stack Developer with 5+ years of experience building production web applications, REST APIs, booking workflows, educational platforms, and cloud-native services across React/TypeScript frontend and Node.js/Express backend systems. Experienced in owning features end-to-end across UI workflows, REST API integration, authentication, role-based access control, PostgreSQL/Prisma, MongoDB/Mongoose, Redis, DynamoDB, AWS Lambda, SQS, Kafka, Docker, Kubernetes, documentation, testing, and production readiness. Able to shift delivery focus toward frontend or backend requirements while keeping product, reliability, and maintainability in view.";
}

function replaceSummary(content: string, title: string): string {
    const lines = content.split(/\r?\n/);
    const skillsIndex = lines.findIndex((line) => /^Skills:?$/i.test(line.trim()));

    if (skillsIndex === -1) return content;

    for (let index = skillsIndex - 1; index >= 0; index--) {
        const line = lines[index].trim();

        if (!line) continue;

        if (
            /^DMITRII BANK/i.test(line) ||
            /^phone:/i.test(line) ||
            /^email:/i.test(line) ||
            /linkedin\.com|github\.com|@\S+/i.test(line) ||
            /hebrew|english|russian/i.test(line) ||
            /\b(developer|engineer)\b/i.test(line) && line.includes("|")
        ) {
            continue;
        }

        if (line.length >= 80) {
            lines[index] = fallbackSummary(title);
        }
        break;
    }

    return lines.join("\n");
}

function fallbackBullets(company: "Inetex" | "VTA Center" | "AVSD+", title: string): string {
    const role = detectHeaderRole(title);
    const bullets: Record<keyof typeof HEADER_STACK_DEFAULTS, Record<typeof company, string>> = {
        backend: {
            Inetex: [
                "• Designed and maintained Node.js/TypeScript REST APIs for booking flows, locker management, user roles, and admin/operator workflows",
                "• Implemented PostgreSQL persistence with Prisma and Redis/DynamoDB cache state for stations, lockers, bookings, and async operation tracking",
                "• Built SQS-based command processing, AWS Lambda workers, and Kafka-aware event-driven patterns for asynchronous locker operations",
                "• Integrated Stripe webhook handling into backend payment flows while keeping authentication, authorization, and booking state transitions consistent",
                "• Strengthened production readiness with JWT authentication, RBAC, Zod validation, Helmet, CORS, rate limiting, audit logs, security alerts, Winston logging, and Kubernetes-ready service practices",
                "• Documented APIs and operational flows with Swagger/OpenAPI and Postman, supported local development with Docker Compose and LocalStack, and used Claude Code, Cursor AI, GitHub Copilot, and OpenAI Codex to accelerate implementation, debugging, and review",
            ].join("\n"),
            "VTA Center": [
                "• Developed Express.js and TypeScript REST APIs for authentication, users, quizzes, questions, lectures, and educational assessment workflows",
                "• Designed MongoDB/Mongoose models and schemas for users, quiz content, question banks, lectures, scores, and admin-managed content",
                "• Implemented JWT authentication, Passport Google OAuth, role/permission utilities, private route support, and request validation with Zod",
                "• Added security and reliability middleware including helmet, express-rate-limit, hpp, express-mongo-sanitize, CORS, cookie parsing, centralized errors, and audit logging",
                "• Supported maintainability with Swagger UI documentation, Winston/Morgan logging, nodemailer utilities, Jest/Supertest tests, and Docker Compose for API plus MongoDB",
            ].join("\n"),
            "AVSD+": [
                "• Built and maintained customer-facing React web pages for healthcare services, service discovery, and patient inquiry flows",
                "• Integrated UI forms and callback request workflows with REST APIs to support patient communication and lead handling",
                "• Improved responsive behavior, page maintainability, and cross-browser consistency across desktop and mobile experiences",
            ].join("\n"),
        },
        frontend: {
            Inetex: [
                "• Built React 18 and TypeScript interfaces for smart locker booking, locker management, and admin/operator/user workflows using Vite and Material UI",
                "• Integrated frontend flows with REST APIs, JWT authentication, Google OAuth, Stripe payment states, and backend validation/error responses",
                "• Implemented state and data-fetching patterns with Zustand, TanStack React Query, Axios, React Router, and role-based navigation/private routes",
                "• Developed operational UI surfaces including data grids, booking views, locker/station management screens, and map-based station interactions with Leaflet",
                "• Improved production readiness through reusable components, loading/error states, form validation, ESLint, Jest, Testing Library, backend/QA collaboration, and AI-assisted implementation with Claude Code, Cursor AI, GitHub Copilot, and OpenAI Codex",
            ].join("\n"),
            "VTA Center": [
                "• Developed React and TypeScript UI workflows for quizzes, score pages, lecture viewing, anatomy pages, and admin-managed educational content",
                "• Managed application state with Redux Toolkit, React Redux, Redux Persist, React Router, and role-based/private route patterns",
                "• Integrated REST APIs, JWT authentication, and Google OAuth flows into frontend screens with clear loading, validation, and error states",
                "• Built Material UI and MUI Data Grid interfaces for content, assessment, and admin workflows while improving responsive behavior and maintainability",
                "• Supported frontend quality with ESLint, TypeScript builds, React PDF usage, and attention to performance and bundle behavior",
            ].join("\n"),
            "AVSD+": [
                "• Built and maintained customer-facing React web applications for healthcare services",
                "• Integrated frontend applications with REST APIs, callback request forms, and patient inquiry workflows",
                "• Improved performance, maintainability, and responsive behavior across desktop and mobile platforms",
            ].join("\n"),
        },
        fullstack: {
            Inetex: [
                "• Owned end-to-end features for a smart locker rental platform, covering booking flows, locker management, role-based access, and admin/operator/user interfaces",
                "• Built React/TypeScript frontend workflows with REST API integration, Google OAuth/JWT auth flows, Material UI screens, data grids, maps, and payment-state handling",
                "• Developed Node.js/TypeScript Express APIs with PostgreSQL/Prisma persistence, Redis station cache, and DynamoDB operation/booking/locker cache state",
                "• Implemented async locker operations using AWS Lambda workers, SQS-based command processing, SNS/SQS patterns, Kafka-aware event-driven workflows, and Kubernetes-ready service practices",
                "• Integrated Stripe webhook handling and strengthened production readiness with RBAC, Zod validation, audit logs, security alerts, Swagger/OpenAPI, Postman, Docker Compose, LocalStack, and AI-assisted development with Claude Code, Cursor AI, GitHub Copilot, and OpenAI Codex",
            ].join("\n"),
            "VTA Center": [
                "• Delivered full-stack features for an educational assessment platform covering quiz/test UI, score pages, lecture viewing, anatomy content, and admin content workflows",
                "• Built React/TypeScript frontend flows with Redux Toolkit, React Router, Material UI, MUI Data Grid, React PDF, JWT authentication, and Google OAuth integration",
                "• Developed Node.js/Express APIs with MongoDB/Mongoose models for users, quizzes, questions, lectures, scores, and content management",
                "• Added Zod validation, role/permission utilities, security middleware, logging, Swagger UI documentation, Jest/Supertest tests, and Docker Compose setup",
            ].join("\n"),
            "AVSD+": [
                "• Built and maintained customer-facing web applications for healthcare services",
                "• Integrated frontend applications with backend APIs and business workflows",
                "• Improved performance, maintainability, and responsiveness across desktop and mobile platforms",
            ].join("\n"),
        },
    };

    return bullets[role][company];
}

function templateBullets(content: string, company: "Inetex" | "VTA Center" | "AVSD+", title: string): string {
    return fallbackBullets(company, title);
}

function replaceSkillsSection(content: string, title: string): string {
    const skills = buildSkillsForTitle(title);

    return content.replace(
        /^SKILLS:?\s*[\r\n]+[\s\S]*?(?=\n(?:Experience|EXPERIENCE|Inetex LTD|\d{4}\s*[–-]\s*Present))/im,
        `Skills\n\n${skills}\n\n`,
    );
}

function replaceTechnologiesLines(content: string, title: string): string {
    const companies: Array<"Inetex" | "VTA Center" | "AVSD+"> = ["Inetex", "VTA Center", "AVSD+"];
    const lines = content.split(/\r?\n/);
    let activeCompany: typeof companies[number] | undefined;

    return lines.map((line) => {
        const matchingCompany = companies.find((company) =>
            line.toLowerCase().includes(company.toLowerCase())
        );
        if (matchingCompany) {
            activeCompany = matchingCompany;
        }

        if (activeCompany && /^Technologies:/i.test(line.trim())) {
            return `Technologies: ${templateTechnologies(content, activeCompany, title)}`;
        }

        return line;
    }).join("\n");
}

function replaceExperienceBullets(content: string, title: string): string {
    const companies: Array<"Inetex" | "VTA Center" | "AVSD+"> = ["Inetex", "VTA Center", "AVSD+"];
    let updated = content;

    for (const company of companies) {
        const escapedCompany = company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const companyRegex = new RegExp(
            `((?:^|\\n).*${escapedCompany}.*\\n(?:.*\\n)*?)([•*-]\\s+[\\s\\S]*?)(?=\\nTechnologies:)`,
            "i",
        );

        updated = updated.replace(companyRegex, (_match, prefix) =>
            `${prefix}${templateBullets(updated, company, title)}`
        );
    }

    return updated;
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

    const repaired = lines.join("\n").trimEnd();

    return replaceTechnologiesLines(
        replaceExperienceBullets(
            replaceSkillsSection(replaceSummary(repaired, title), title),
            title,
        ),
        title,
    ).trimEnd() + "\n";
}

async function findMarkdownFiles(root: string): Promise<string[]> {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
        const fullPath = path.join(root, entry.name);

        if (entry.isDirectory()) {
            files.push(...await findMarkdownFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
            files.push(fullPath);
        }
    }

    return files;
}

async function main() {
    const resumesRoot = path.join(process.cwd(), "storage", "resumes");
    const markdownFiles = await findMarkdownFiles(resumesRoot);
    const repaired: string[] = [];

    for (const markdownPath of markdownFiles) {
        const dir = path.dirname(markdownPath);
        const baseName = path.basename(markdownPath, ".md");
        const docxPath = path.join(dir, `${baseName}.docx`);
        const pdfPath = path.join(dir, `${baseName}.pdf`);
        const content = await fs.readFile(markdownPath, "utf8");
        const title = await buildHeaderTitleForDocx(content, docxPath);
        const repairedContent = repairMarkdownContent(content, title);
        await fs.writeFile(markdownPath, repairedContent);
        const templateData = {
            TITLE: title,
            SUMMARY: alignSummaryWithRole(extractSummary(repairedContent), title),
            SKILLS: buildSkillsForTitle(title),
            INETEX_BULLETS: templateBullets(repairedContent, "Inetex", title),
            INETEX_TECHNOLOGIES: templateTechnologies(repairedContent, "Inetex", title),
            VTA_BULLETS: templateBullets(repairedContent, "VTA Center", title),
            VTA_TECHNOLOGIES: templateTechnologies(repairedContent, "VTA Center", title),
            AVSD_BULLETS: templateBullets(repairedContent, "AVSD+", title),
            AVSD_TECHNOLOGIES: templateTechnologies(repairedContent, "AVSD+", title),
        };

        await createResumeFromTemplate(
            templateData,
            docxPath,
        );
        await createResumePdfFromTemplate(templateData, pdfPath);

        repaired.push(docxPath);
    }

    console.log(JSON.stringify({ repairedCount: repaired.length, repaired }, null, 2));
}

void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
}).finally(() => prisma.$disconnect());
