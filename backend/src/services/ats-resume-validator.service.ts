import { Job } from "@prisma/client";

type Role = "frontend" | "backend" | "fullstack" | "platform" | "data" | "security" | "qa" | "general";

export type AtsResumeValidation = {
    score: number;
    role: Role;
    issues: string[];
    matchedKeywords: string[];
    missingImportantKeywords: string[];
};

const KEYWORDS = [
    "TypeScript", "JavaScript", "React", "Angular", "Vue", "Node.js", "Express", "NestJS",
    "REST", "REST APIs", "GraphQL", "AWS", "Lambda", "SQS", "SNS", "DynamoDB",
    "Docker", "Kubernetes", "MongoDB", "PostgreSQL", "Redis", "NoSQL", "SQL",
    "SaaS", "Microservices", "CI/CD", "Testing", "Jest", "Playwright", "Python",
    "Security", "JWT", "RBAC", "Datadog", "Splunk", "Firebase", "Figma",
];

const TECHNOLOGY_EVIDENCE_RULES: Array<{ label: string; tech: RegExp; evidence: RegExp }> = [
    { label: "React", tech: /\breact\b/i, evidence: /\breact\b|frontend|front-end|ui|interface|component|screen|responsive|state management|api integration/i },
    { label: "Angular", tech: /\bangular\b/i, evidence: /\bangular\b|frontend|front-end|ui|interface|component|screen|responsive|state management|api integration/i },
    { label: "Vue", tech: /\bvue\b/i, evidence: /\bvue\b|frontend|front-end|ui|interface|component|screen|responsive|state management|api integration/i },
    { label: "Next.js", tech: /\bnext\.?js\b/i, evidence: /\bnext\.?js\b|frontend|front-end|ui|interface|component|screen|server-side rendering|ssr/i },
    { label: "NestJS", tech: /\bnestjs\b/i, evidence: /\bnestjs\b/i },
    { label: "Express.js", tech: /\bexpress(?:\.js)?\b/i, evidence: /\bexpress(?:\.js)?\b/i },
    { label: "MongoDB", tech: /\bmongodb\b/i, evidence: /\bmongodb\b/i },
    { label: "PostgreSQL", tech: /\bpostgresql\b/i, evidence: /\bpostgresql\b/i },
    { label: "Redis", tech: /\bredis\b/i, evidence: /\bredis\b/i },
    { label: "DynamoDB", tech: /\bdynamodb\b/i, evidence: /\bdynamodb\b/i },
    { label: "Prisma", tech: /\bprisma\b/i, evidence: /\bprisma\b/i },
    { label: "AWS Lambda", tech: /\blambda\b/i, evidence: /\blambda\b|serverless|aws|cloud|function/i },
    { label: "SQS", tech: /\bsqs\b/i, evidence: /\bsqs\b|queue|async|asynchronous|event-driven|messaging/i },
    { label: "SNS", tech: /\bsns\b/i, evidence: /\bsns\b|notification|pub\/sub|event-driven|messaging/i },
    { label: "Docker", tech: /\bdocker\b/i, evidence: /\bdocker\b|containerized/i },
    { label: "Kubernetes", tech: /\bkubernetes\b/i, evidence: /\bkubernetes\b|k8s\b/i },
    { label: "JWT", tech: /\bjwt\b/i, evidence: /\bjwt\b/i },
    { label: "Zod", tech: /\bzod\b/i, evidence: /\bzod\b/i },
];

function unsupportedTechnologies(technologies: string, bullets: string) {
    return TECHNOLOGY_EVIDENCE_RULES
        .filter((rule) => rule.tech.test(technologies) && !rule.evidence.test(bullets))
        .map((rule) => rule.label);
}

function isTechnologyItemSupported(item: string, bullets: string) {
    const matchingRules = TECHNOLOGY_EVIDENCE_RULES.filter((rule) => rule.tech.test(item));
    if (matchingRules.length === 0) return true;

    return matchingRules.some((rule) => rule.evidence.test(bullets));
}

function normalize(value: string) {
    return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function hasPhrase(text: string, phrase: string) {
    const escaped = phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i").test(text);
}

function inferRole(job: Job): Role {
    const title = normalize(job.title);
    const description = normalize(job.description);

    for (const text of [title, description]) {
        if (/full[\s-]?stack|fullstack/.test(text)) return "fullstack";
        if (/security|cyber/.test(text)) return "security";
        if (/qa|quality|test automation|automation lead/.test(text)) return "qa";
        if (/data|analytics|machine learning|ai/.test(text)) return "data";
        if (/backend|back-end|node|api|server/.test(text)) return "backend";
        if (/frontend|front-end|angular|react|ui|ux/.test(text)) return "frontend";
        if (/platform|cloud|devops|infra|sre|ci\/cd/.test(text)) return "platform";
    }

    return "general";
}

function extractSection(content: string, heading: string) {
    const headingPattern = heading === "Experience"
        ? "(?:experience|work experience|professional experience)"
        : heading === "Summary"
            ? "(?:summary|professional summary)"
            : heading;
    const match = new RegExp(
        `(?:^|\\n)(?:#{1,3}\\s*)?${headingPattern}\\s*\\n([\\s\\S]*?)(?=\\n(?:#{1,3}\\s*)?(?:summary|professional summary|skills|experience|work experience|professional experience|education)\\s*\\n|$)`,
        "i",
    ).exec(content);
    return match?.[1]?.trim() ?? "";
}

function firstNonEmptyLines(content: string, count: number) {
    return content.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, count);
}

function stripMarkdownHeading(value: string) {
    return value.replace(/^#+\s*/, "").trim();
}

function normalizeRoleLabel(value: string) {
    return normalize(stripMarkdownHeading(value).replace(/^target title line:\s*/i, "").split("|")[0] ?? value)
        .replace(/\s+/g, " ")
        .trim();
}

function importantJobKeywords(job: Job) {
    const text = `${job.title}\n${job.description}`;
    return KEYWORDS.filter((keyword) => hasPhrase(text, keyword));
}

function extractExperienceBlocks(content: string) {
    const experience = extractSection(content, "Experience");
    return experience
        .split(/\n###\s+/)
        .map((block) => block.trim())
        .filter(Boolean);
}

function firstExperienceBlock(content: string) {
    const blocks = extractExperienceBlocks(content);
    return blocks[0] ?? "";
}

function isExperienceRoleHeader(line: string) {
    return /\b(?:19|20)\d{2}\b/.test(line) && /\|/.test(line);
}

function isTechnologiesLine(line: string) {
    return /^Technologies:/i.test(line.trim());
}

function extractSupportedBulletTextFromExperienceBlock(block: string) {
    let nonEmptySinceRoleHeader = 0;
    const result: string[] = [];

    for (const line of block.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (isExperienceRoleHeader(trimmed)) {
            nonEmptySinceRoleHeader = 0;
            continue;
        }

        if (isTechnologiesLine(trimmed)) continue;

        nonEmptySinceRoleHeader += 1;
        if (/^[-*•●]\s+/.test(trimmed)) {
            result.push(trimmed.replace(/^[-*•●]\s+/, ""));
        } else if (nonEmptySinceRoleHeader >= 2) {
            result.push(trimmed);
        }
    }

    return result.join(" ");
}

export function validateResumeAgainstJob(job: Job, content: string): AtsResumeValidation {
    const role = inferRole(job);
    const issues: string[] = [];
    const normalizedResume = normalize(content);
    const header = firstNonEmptyLines(content, 8).join(" ");
    const lines = firstNonEmptyLines(content, 12);
    const targetLine = lines[1] ?? "";
    const targetRole = normalizeRoleLabel(targetLine);
    const summarySection = extractSection(content, "Summary");
    const summaryLine = firstNonEmptyLines(summarySection, 1)[0] ?? "";
    const summaryRoleStart = normalizeRoleLabel(summaryLine.split(/\s+with\s+|\s+who\s+|\s+specializing\s+/i)[0] ?? summaryLine);
    const summary = summarySection || (content.split(/(?:^|\n)(?:#{1,3}\s*)?skills\s*\n/i)[0] ?? "");
    const skills = extractSection(content, "Skills");
    const normalizedSkills = normalize(skills);
    const jobKeywords = importantJobKeywords(job);
    const matchedKeywords = jobKeywords.filter((keyword) => hasPhrase(content, keyword));
    const missingImportantKeywords = jobKeywords
        .filter((keyword) => !hasPhrase(content, keyword))
        .slice(0, 8);
    const currentExperience = firstExperienceBlock(content);
    const currentTechnologies = /technologies:\s*([^\n]+)/i.exec(currentExperience)?.[1] ?? "";
    const currentBullets = extractSupportedBulletTextFromExperienceBlock(currentExperience);
    const currentTechHasFrontend = /(react|angular|vue|html|css|redux|material ui|frontend|ui)/i.test(currentTechnologies);
    const currentBulletsHaveFrontend = /(react|angular|vue|frontend|ui|responsive|customer-facing|screen|interface|state management|api integration)/i.test(currentBullets);
    const currentTechHasCloud = /(aws|lambda|sqs|sns|docker|kubernetes|ci\/cd|monitoring|logging|production support)/i.test(currentTechnologies);
    const currentBulletsHaveCloud = /(aws|lambda|sqs|sns|cloud|deploy|deployment|docker|kubernetes|async|event-driven|monitoring|logging|observability|production)/i.test(currentBullets);
    const unsupportedCurrentTechnologies = unsupportedTechnologies(currentTechnologies, currentBullets);

    if (!skills) {
        issues.push("Missing ## Skills section.");
    }

    if (targetRole && summaryRoleStart && targetRole !== summaryRoleStart) {
        issues.push(`Summary starts with "${summaryLine.split(/\s+with\s+|\s+who\s+|\s+specializing\s+/i)[0]}" but header role is "${targetLine.split("|")[0].trim()}".`);
    }

    if (role === "fullstack") {
        if (!/frontend:/i.test(skills)) issues.push("Full-stack resume is missing Frontend skills category.");
        if (!/backend:/i.test(skills)) issues.push("Full-stack resume is missing Backend skills category.");
        if (!/(react|angular|vue|typescript|javascript|html|css)/i.test(skills)) {
            issues.push("Full-stack resume does not show supported frontend technologies in Skills.");
        }
        if (!/(node\.js|express|nestjs|rest|api|microservices)/i.test(skills)) {
            issues.push("Full-stack resume does not show supported backend technologies in Skills.");
        }
        if (currentTechHasFrontend && !currentBulletsHaveFrontend) {
            issues.push("Current role Technologies lists frontend/UI tech but current role bullets do not show frontend/UI work.");
        }
    }

    if (currentTechHasCloud && !currentBulletsHaveCloud) {
        issues.push("Current role Technologies lists cloud/infrastructure tech but current role bullets do not show cloud/infrastructure work.");
    }

    if (unsupportedCurrentTechnologies.length > 0) {
        issues.push(`Current role Technologies are not supported by current role bullets: ${unsupportedCurrentTechnologies.join(", ")}.`);
    }

    if (role === "frontend" && !/frontend:/i.test(skills)) {
        issues.push("Frontend resume is missing Frontend skills category.");
    }

    if (role === "backend" && !/backend:/i.test(skills)) {
        issues.push("Backend resume is missing Backend skills category.");
    }

    const summaryMentionsFrontend = /(react|angular|vue|frontend|front-end|ui|ux)/i.test(summary);
    if (summaryMentionsFrontend && !/(react|angular|vue|frontend|ui|ux|html|css)/i.test(skills)) {
        issues.push("Summary mentions frontend/UI experience but Skills does not reflect it.");
    }

    for (const keyword of matchedKeywords) {
        if (hasPhrase(header, keyword) || hasPhrase(summary, keyword)) {
            if (!hasPhrase(normalizedSkills, keyword)) {
                issues.push(`Keyword "${keyword}" appears in header/summary but is missing from Skills.`);
            }
        }
    }

    const issuePenalty = Math.min(70, issues.length * 12);
    const missingPenalty = Math.min(10, missingImportantKeywords.length);
    const score = Math.max(0, Math.min(100, 100 - issuePenalty - missingPenalty));

    if (normalizedResume.includes("senior backend developer | aws | node.js | typescript | nosql") && role !== "backend") {
        issues.push("Old fixed backend target line is still present for a non-backend role.");
    }

    return {
        score,
        role,
        issues,
        matchedKeywords,
        missingImportantKeywords,
    };
}

export function removeUnsupportedTechnologiesFromExperience(content: string): string {
    const parts = /([\s\S]*?(?:^|\n)(?:#{1,3}\s*)?(?:experience|work experience|professional experience)\s*\n)([\s\S]*?)(\n(?:#{1,3}\s*)?education[\s\S]*|$)/i.exec(content);
    if (!parts) return content;

    const [, beforeExperience, experience, afterExperience] = parts;
    const rebuilt = experience
        .split(/(?=\n?###\s+)/)
        .map((block) => {
            if (!block.trim()) return block;

            // Collect all non-empty content lines as supported text —
            // handles both markdown format (- bullet) and DOCX-extracted format
            // (plain paragraphs without leading dash).
            const bullets = block
                .split("\n")
                .filter((line) => {
                    const t = line.trim();
                    return t &&
                        !isTechnologiesLine(t) &&
                        !isExperienceRoleHeader(t);
                })
                .join(" ");

            return block.replace(/^Technologies:\s*(.+)$/gim, (_line, rawTechnologies: string) => {
                const kept = rawTechnologies
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean)
                    .filter((item) => isTechnologyItemSupported(item, bullets));

                return kept.length ? `Technologies: ${kept.join(", ")}` : "";
            });
        })
        .join("");

    return `${beforeExperience}${rebuilt}${afterExperience}`;
}
