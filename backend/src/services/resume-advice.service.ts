import { prisma } from "../infrastructure/prisma";

type SkillDefinition = {
    name: string;
    aliases: string[];
    category: "Frontend" | "Backend" | "Cloud & DevOps" | "Database" | "Testing" | "AI" | "Other";
};

type SkillGap = {
    skill: string;
    category: SkillDefinition["category"];
    missingInResume: boolean;
    requiredInJobs: number;
    requiredInFilteredJobs: number;
    percentageOfJobs: number;
    percentageOfFilteredJobs: number;
    exampleJobs: Array<{
        id: string;
        title: string;
        company: string | null;
        matchScore: number | null;
        recommendation: string | null;
    }>;
};

const SKILL_CATALOG: SkillDefinition[] = [
    { name: "React", category: "Frontend", aliases: ["react", "react.js", "reactjs"] },
    { name: "TypeScript", category: "Frontend", aliases: ["typescript", "type script"] },
    { name: "JavaScript", category: "Frontend", aliases: ["javascript", "java script", "es6"] },
    { name: "Next.js", category: "Frontend", aliases: ["next.js", "nextjs", "next js"] },
    { name: "Vite", category: "Frontend", aliases: ["vite"] },
    { name: "Material UI", category: "Frontend", aliases: ["material ui", "mui", "material-ui"] },
    { name: "Redux Toolkit", category: "Frontend", aliases: ["redux toolkit", "@reduxjs/toolkit"] },
    { name: "TanStack React Query", category: "Frontend", aliases: ["tanstack query", "react query", "tanstack react query"] },
    { name: "Node.js", category: "Backend", aliases: ["node.js", "nodejs", "node js"] },
    { name: "Express", category: "Backend", aliases: ["express", "express.js", "express js"] },
    { name: "NestJS", category: "Backend", aliases: ["nestjs", "nest js", "nest.js"] },
    { name: "REST API", category: "Backend", aliases: ["rest api", "restful", "rest apis"] },
    { name: "GraphQL", category: "Backend", aliases: ["graphql", "graph ql"] },
    { name: "JWT", category: "Backend", aliases: ["jwt", "json web token", "json web tokens"] },
    { name: "OAuth", category: "Backend", aliases: ["oauth", "oauth2", "google oauth"] },
    { name: "PostgreSQL", category: "Database", aliases: ["postgresql", "postgres", "postgre sql"] },
    { name: "MongoDB", category: "Database", aliases: ["mongodb", "mongo db"] },
    { name: "Redis", category: "Database", aliases: ["redis"] },
    { name: "Prisma", category: "Database", aliases: ["prisma"] },
    { name: "DynamoDB", category: "Database", aliases: ["dynamodb", "dynamo db"] },
    { name: "AWS", category: "Cloud & DevOps", aliases: ["aws", "amazon web services"] },
    { name: "AWS Lambda", category: "Cloud & DevOps", aliases: ["aws lambda", "lambda functions"] },
    { name: "SQS", category: "Cloud & DevOps", aliases: ["sqs", "amazon sqs"] },
    { name: "SNS", category: "Cloud & DevOps", aliases: ["sns", "amazon sns"] },
    { name: "Docker", category: "Cloud & DevOps", aliases: ["docker"] },
    { name: "Docker Compose", category: "Cloud & DevOps", aliases: ["docker compose", "docker-compose"] },
    { name: "Kubernetes", category: "Cloud & DevOps", aliases: ["kubernetes", "k8s"] },
    { name: "Kafka", category: "Cloud & DevOps", aliases: ["kafka", "apache kafka"] },
    { name: "CI/CD", category: "Cloud & DevOps", aliases: ["ci/cd", "cicd", "continuous integration"] },
    { name: "Jest", category: "Testing", aliases: ["jest"] },
    { name: "Testing Library", category: "Testing", aliases: ["testing library", "react testing library"] },
    { name: "Supertest", category: "Testing", aliases: ["supertest"] },
    { name: "Playwright", category: "Testing", aliases: ["playwright"] },
    { name: "Stripe", category: "Backend", aliases: ["stripe", "stripe webhooks"] },
    { name: "OpenAI", category: "AI", aliases: ["openai", "open ai", "gpt", "llm"] },
    { name: "GitHub Copilot", category: "AI", aliases: ["github copilot", "copilot"] },
    { name: "Cursor AI", category: "AI", aliases: ["cursor ai", "cursor"] },
    { name: "OpenAI Codex", category: "AI", aliases: ["openai codex", "codex"] },
];

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasAlias(text: string, alias: string): boolean {
    const escaped = escapeRegExp(alias.toLowerCase());
    return new RegExp(`(^|[^a-z0-9+#.])${escaped}([^a-z0-9+#.]|$)`, "i").test(text);
}

function hasSkill(text: string, skill: SkillDefinition): boolean {
    const normalized = text.toLowerCase();
    return skill.aliases.some((alias) => hasAlias(normalized, alias));
}

function getRecommendation(analysis: unknown): string | null {
    if (!analysis || typeof analysis !== "object") return null;
    const value = (analysis as Record<string, unknown>).recommendation;
    return typeof value === "string" ? value : null;
}

function getMissingSkillNames(analysis: unknown): string[] {
    if (!analysis || typeof analysis !== "object") return [];
    const value = (analysis as Record<string, unknown>).missingSkills;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isFilteredJob(matchScore: number | null, recommendation: string | null, minMatchScore: number): boolean {
    return recommendation === "SKIP" || (matchScore != null && matchScore < minMatchScore);
}

export async function buildResumeAdvice(options: { userId: string; limit?: number; minMatchScore?: number }) {
    const limit = Number.isFinite(options.limit) && options.limit && options.limit > 0 ? options.limit : 300;
    const minMatchScore = Number.isFinite(options.minMatchScore) && options.minMatchScore != null
        ? Math.max(0, Math.min(100, options.minMatchScore))
        : 70;

    const user = await prisma.appUser.findUniqueOrThrow({
        where: { id: options.userId },
        include: {
            resumeBases: {
                orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
                take: 1,
            },
        },
    });

    const resumeText = user.resumeBases[0]?.content ?? "";
    if (!resumeText) {
        throw new Error("Create at least one base resume first.");
    }

    const matches = await prisma.userJobMatch.findMany({
        where: { userId: options.userId },
        orderBy: { updatedAt: "desc" },
        take: limit,
        select: {
            matchScore: true,
            analysis: true,
            job: {
                select: {
                    id: true,
                    title: true,
                    company: true,
                    description: true,
                },
            },
        },
    });
    const jobs = matches.map((match) => ({
        ...match.job,
        matchScore: match.matchScore,
        analysis: match.analysis,
    }));

    const resumeSkills = new Set(
        SKILL_CATALOG
            .filter((skill) => hasSkill(resumeText, skill))
            .map((skill) => skill.name),
    );

    const filteredJobs = jobs.filter((job) => isFilteredJob(job.matchScore, getRecommendation(job.analysis), minMatchScore));
    const gapMap = new Map<string, SkillGap>();

    for (const skill of SKILL_CATALOG) {
        const missingInResume = !resumeSkills.has(skill.name);
        if (!missingInResume) continue;

        const matchingJobs = jobs.filter((job) => hasSkill(`${job.title}\n${job.description}`, skill));
        const matchingFilteredJobs = matchingJobs.filter((job) =>
            isFilteredJob(job.matchScore, getRecommendation(job.analysis), minMatchScore)
        );

        if (!matchingJobs.length) continue;

        gapMap.set(skill.name, {
            skill: skill.name,
            category: skill.category,
            missingInResume,
            requiredInJobs: matchingJobs.length,
            requiredInFilteredJobs: matchingFilteredJobs.length,
            percentageOfJobs: jobs.length ? Math.round((matchingJobs.length / jobs.length) * 100) : 0,
            percentageOfFilteredJobs: filteredJobs.length ? Math.round((matchingFilteredJobs.length / filteredJobs.length) * 100) : 0,
            exampleJobs: matchingJobs.slice(0, 3).map((job) => ({
                id: job.id,
                title: job.title,
                company: job.company,
                matchScore: job.matchScore,
                recommendation: getRecommendation(job.analysis),
            })),
        });
    }

    for (const job of jobs) {
        const recommendation = getRecommendation(job.analysis);
        const filtered = isFilteredJob(job.matchScore, recommendation, minMatchScore);

        for (const missingSkill of getMissingSkillNames(job.analysis)) {
            const definition = SKILL_CATALOG.find((skill) =>
                skill.name.toLowerCase() === missingSkill.toLowerCase() ||
                skill.aliases.some((alias) => alias.toLowerCase() === missingSkill.toLowerCase())
            );
            if (!definition || resumeSkills.has(definition.name)) continue;

            const existing = gapMap.get(definition.name);
            if (!existing) continue;

            existing.requiredInJobs = Math.max(existing.requiredInJobs, 1);
            existing.requiredInFilteredJobs += filtered ? 1 : 0;
        }
    }

    const gaps = [...gapMap.values()]
        .sort((a, b) =>
            b.requiredInFilteredJobs - a.requiredInFilteredJobs ||
            b.requiredInJobs - a.requiredInJobs ||
            a.skill.localeCompare(b.skill)
        )
        .slice(0, 15);

    return {
        generatedAt: new Date().toISOString(),
        resumeId: user.resumeBases[0].id,
        totalJobsAnalyzed: jobs.length,
        filteredJobsCount: filteredJobs.length,
        minMatchScore,
        skillsDetectedInResume: [...resumeSkills].sort(),
        gaps,
        summary: gaps.length
            ? `Found ${gaps.length} missing skill groups across ${jobs.length} recent vacancies. ${filteredJobs.length} vacancies were below ${minMatchScore}/100 or marked SKIP.`
            : `No major missing skills detected across ${jobs.length} recent vacancies.`,
    };
}
