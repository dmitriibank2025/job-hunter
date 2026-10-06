import { createHash } from "crypto";
import { z } from "zod";
import type { CandidateContext } from "./candidate-context.service";

export const stableId = (prefix: string, ...parts: string[]) =>
  `${prefix}_${createHash("sha256")
    .update(
      JSON.stringify(
        parts.map((p) =>
          p.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase(),
        ),
      ),
    )
    .digest("hex")
    .slice(0, 24)}`;
const text = z.string().trim().min(1).max(12000);
export const requirementSchema = z
  .object({
    term: text,
    normalized: text,
    category: z.enum([
      "backend",
      "frontend",
      "cloudDevOps",
      "databases",
      "aiLlm",
      "testingObservability",
      "security",
      "architecture",
      "domain",
      "responsibility",
      "softSkills",
      "technology",
    ]),
    classification: z.enum(["MUST_HAVE", "NICE_TO_HAVE", "CONTEXTUAL"]),
    importance: z.number().int().min(1).max(10),
    sourceQuote: text,
  })
  .strict();
export const analysisSchema = z
  .object({
    targetTitle: text,
    alternativeTitles: z.array(text).max(10),
    seniority: z.enum([
      "intern",
      "junior",
      "mid",
      "senior",
      "lead",
      "staff",
      "principal",
      "unspecified",
    ]),
    requirements: z.array(requirementSchema).max(100),
  })
  .strict();
export type Requirement = z.infer<typeof requirementSchema> & { id: string };
export type JobAnalysis = Omit<
  z.infer<typeof analysisSchema>,
  "requirements"
> & { requirements: Requirement[] };
export const plannerSchema = z
  .object({
    queries: z
      .array(
        z
          .object({
            requirementId: text,
            query: text,
            topK: z.number().int().min(1).max(10),
          })
          .strict(),
      )
      .max(12),
  })
  .strict();
export const statusSchema = z.enum([
  "SUPPORTED",
  "PARTIALLY_SUPPORTED",
  "UNSUPPORTED",
]);
export const mappingSchema = z
  .object({
    requirements: z
      .array(
        z
          .object({
            requirementId: text,
            status: statusSchema,
            evidenceIds: z.array(text).max(30),
            confidence: z.number().min(0).max(1),
            reason: text,
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export type EvidenceMap = z.infer<typeof mappingSchema>;
export const claimSchema = z
  .object({
    text,
    evidenceIds: z.array(text).min(1).max(20),
    requirementIds: z.array(text).max(100),
    keywords: z.array(text).max(40),
    evidenceStatus: statusSchema,
  })
  .strict();
export type ResumeClaim = z.infer<typeof claimSchema>;
const entrySchema = z
  .object({
    entityId: text,
    header: claimSchema,
    description: z.array(claimSchema).max(3),
    bullets: z.array(claimSchema).min(1).max(8),
    technologies: z.array(claimSchema).max(30),
  })
  .strict();
export const resumeSchema = z
  .object({
    targetTitle: claimSchema,
    summary: z.array(claimSchema).min(1).max(3),
    skills: z
      .array(
        z
          .object({
            category: text,
            items: z.array(claimSchema).min(1).max(40),
          })
          .strict(),
      )
      .min(1)
      .max(16),
    experience: z.array(entrySchema).max(10),
    projects: z.array(entrySchema).max(10),
    education: z.array(claimSchema).min(1).max(10),
  })
  .strict();
export type EvidenceResume = z.infer<typeof resumeSchema>;
export const criticSchema = z
  .object({
    issues: z.array(text).max(30),
    strengths: z.array(text).max(30),
    recommendedChanges: z.array(text).max(30),
    needsRepair: z.boolean(),
  })
  .strict();
export type VerifiedEvidence = {
  id: string;
  text: string;
  source: string;
  kind:
    | "title"
    | "summary"
    | "skill"
    | "header"
    | "description"
    | "bullet"
    | "technology"
    | "education";
  context: "profile" | "commercial" | "personal";
  entityId?: string;
  category?: string;
};
export type EvidenceCorpus = {
  evidence: VerifiedEvidence[];
  contactLines: string[];
  entityIds: { commercial: string[]; personal: string[] };
  categories: string[];
};

/** Build evidence directly from canonical user-owned facts, without reparsing a resume snapshot. */
export function buildEvidenceCorpusFromCandidateContext(context: CandidateContext): EvidenceCorpus {
  const evidence: VerifiedEvidence[] = [];
  const headerByEntity = new Map(
    context.facts
      .filter((fact) => fact.kind === "HEADER")
      .map((fact) => [fact.entityId, fact.text]),
  );
  const technologyCategories = new Map(
    context.technologies.map((technology) => [technology.name.toLowerCase(), technology.category]),
  );
  const title = context.selectedBase.targetTitle && context.selectedBase.targetTitle !== "Uploaded Resume"
    ? context.selectedBase.targetTitle
    : context.experiences[0]?.title;
  if (title) {
    evidence.push({
      id: stableId("ev", context.userId, context.selectedBase.id, "title", title),
      text: title,
      source: `resume-base:${context.selectedBase.id}`,
      kind: "title",
      context: "profile",
    });
  }

  for (const fact of context.facts) {
    if (!fact.verified || fact.kind === "CONTACT") continue;
    const factContext: VerifiedEvidence["context"] = fact.entityType === "PROJECT"
      ? "personal"
      : fact.entityType === "EXPERIENCE"
        ? "commercial"
        : "profile";
    const kind: VerifiedEvidence["kind"] = fact.kind === "SUMMARY"
      ? "summary"
      : fact.kind === "HEADER"
        ? "header"
        : fact.kind === "DESCRIPTION"
          ? "description"
          : fact.kind === "BULLET"
            ? "bullet"
            : fact.kind === "EDUCATION"
              ? "education"
              : fact.entityType === "TECHNOLOGY"
                ? "skill"
                : "technology";
    evidence.push({
      id: fact.id,
      text: fact.text,
      source: headerByEntity.get(fact.entityId) ?? `${fact.entityType.toLowerCase()}:${fact.entityId}`,
      kind,
      context: factContext,
      ...(fact.entityType === "EXPERIENCE" || fact.entityType === "PROJECT" ? { entityId: fact.entityId } : {}),
      ...(fact.entityType === "TECHNOLOGY"
        ? { category: technologyCategories.get(fact.text.toLowerCase()) ?? "Other" }
        : {}),
    });
  }

  const profile = context.profile;
  const contactLines = [
    profile.fullName,
    profile.location,
    profile.phone ? `Phone: ${profile.phone}` : null,
    profile.linkedin ? `LinkedIn: ${profile.linkedin}` : null,
    profile.email ? `Email: ${profile.email}` : null,
    profile.github ? `GitHub: ${profile.github}` : null,
    profile.portfolio ? `Portfolio: ${profile.portfolio}` : null,
    profile.languages.length ? `Languages: ${profile.languages.join(", ")}` : null,
  ].filter((line): line is string => Boolean(line));

  return {
    evidence,
    contactLines,
    entityIds: {
      commercial: context.experiences.map((experience) => experience.id),
      personal: context.projects.map((project) => project.id),
    },
    categories: [...new Set(context.technologies.map((technology) => technology.category))],
  };
}

/** Source facts are parsed by code, never synthesized by a model. IDs survive reordering. */
export function buildEvidenceCorpus(
  base: string,
  fullName: string,
): EvidenceCorpus {
  const result: EvidenceCorpus = {
    evidence: [],
    contactLines: [],
    entityIds: { commercial: [], personal: [] },
    categories: [],
  };
  let section = "header",
    entityId: string | undefined,
    source = "profile",
    awaitingDescription = false;
  const add = (
    value: string,
    kind: VerifiedEvidence["kind"],
    context: VerifiedEvidence["context"] = "profile",
    category?: string,
  ) => {
    const fact: VerifiedEvidence = {
      id: stableId("ev", source, kind, value),
      text: value,
      source,
      kind,
      context,
      ...(entityId ? { entityId } : {}),
      ...(category ? { category } : {}),
    };
    if (!result.evidence.some((e) => e.id === fact.id))
      result.evidence.push(fact);
  };
  for (const raw of base.split(/\r?\n/)) {
    let line = raw
      .trim()
      .replace(/^#{1,6}\s*/, "")
      .replace(/^\*\*(.*?)\*\*$/, "$1");
    if (!line) continue;
    if (
      /^(summary|professional summary|skills|technical skills|experience|work experience|professional experience|personal projects|projects|education)$/i.test(
        line,
      )
    ) {
      section = /summary/i.test(line)
        ? "summary"
        : /skills/i.test(line)
          ? "skills"
          : /experience/i.test(line)
            ? "commercial"
            : /projects/i.test(line)
              ? "personal"
              : "education";
      entityId = undefined;
      source = section;
      continue;
    }
    if (section === "header") {
      const identityParts = line.split(/\t+|\s{2,}|\s+\|\s+/).map(s => s.trim()).filter(Boolean);
      if (identityParts[0]?.toLowerCase() === fullName.trim().toLowerCase())
        result.contactLines.push(...identityParts);
      else if (/\|/.test(line) && /(?:engineer|developer)/i.test(line) && !/@|linkedin\.com|github\.com|phone:|email:|linkedin:|github:/i.test(line))
        add(line, "title");
      else result.contactLines.push(line);
    } else if (section === "summary") {
      for (const sentence of line.split(/(?<=[.!?])\s+(?=[A-Z])/)) add(sentence, "summary");
    } else if (section === "skills") {
      const match = /^([^:]+):\s*(.+)$/.exec(line);
      if (match) {
        result.categories.push(match[1]);
        for (const item of match[2].split(/,\s*/))
          add(item.trim(), "skill", "profile", match[1]);
      }
    } else if (section === "education") {
      add(line.replace(/^[-*•●]\s*/, ""), "education");
    } else {
      const context = section as "commercial" | "personal";
      if (/^(?:19|20)\d{2}.*\|/.test(line)) {
        entityId = stableId("entity", context, line);
        source = line;
        awaitingDescription = true;
        result.entityIds[context].push(entityId);
        add(line, "header", context);
        const projectStack = line.split("|")[2];
        if (context === "personal" && projectStack?.includes("·"))
          for (const technology of projectStack.split("·"))
            add(technology.trim(), "technology", context);
      } else if (entityId) {
        if (/^Technologies:/i.test(line))
          for (const item of line
            .replace(/^Technologies:\s*/i, "")
            .split(/,\s*/))
            add(item, "technology", context);
        else {
          // DOCX extraction often removes bullet markers. Only the short
          // first subtitle is descriptive; following paragraphs are claims.
          const description =
            awaitingDescription &&
            !/^[-*•●]\s/.test(line) &&
            !/[.!?]$/.test(line) &&
            line.length < 140;
          add(
            line.replace(/^[-*•●]\s*/, ""),
            description ? "description" : "bullet",
            context,
          );
        }
        awaitingDescription = false;
      }
    }
  }
  if (
    !result.evidence.some((e) => e.kind === "title") ||
    !result.evidence.some((e) => e.kind === "education")
  )
    throw new Error(
      "Cannot safely parse candidate title/education from base resume",
    );
  return result;
}

export function assignRequirementIds(
  raw: z.infer<typeof analysisSchema>,
  vacancy: string,
): JobAnalysis {
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const requirements: Requirement[] = [];
  for (const extracted of raw.requirements) {
    // A compound label may be a paraphrase even when its quote is exact.
    // Retain the employer's complete quote rather than admitting invented wording.
    const r = { ...extracted, term: normalize(extracted.sourceQuote).includes(normalize(extracted.term)) ? extracted.term : extracted.sourceQuote };
    if (
      !normalize(vacancy).includes(normalize(r.sourceQuote))
    )
      throw new Error(`Ungrounded vacancy requirement: ${r.term}`);
    const id = stableId("req", r.term, r.category);
    const existing = requirements.find((x) => x.id === id);
    if (existing && existing.classification !== r.classification)
      throw new Error(`Conflicting classification: ${r.term}`);
    if (!existing) requirements.push({ ...r, id });
  }
  return { ...raw, requirements };
}

export const containsTerm = (value: string, term: string) =>
  new RegExp(
    `(?:^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^a-z0-9])`,
    "i",
  ).test(value);

/** Similarity is never authority. Reject foreign IDs; downgrade literal term gaps. */
export function verifyEvidenceMap(
  map: EvidenceMap,
  analysis: JobAnalysis,
  evidence: VerifiedEvidence[],
): EvidenceMap {
  const known = new Map(evidence.map((e) => [e.id, e]));
  if (
    new Set(map.requirements.map((r) => r.requirementId)).size !==
      map.requirements.length ||
    map.requirements.length !== analysis.requirements.length
  )
    throw new Error("Evidence map must cover each requirement exactly once");
  return {
    requirements: map.requirements.map((m) => {
      const requirement = analysis.requirements.find(
        (r) => r.id === m.requirementId,
      );
      if (!requirement || m.evidenceIds.some((id) => !known.has(id)))
        throw new Error("Invalid evidence map reference");
      const exact = m.evidenceIds.some((id) =>
        containsTerm(known.get(id)!.text, requirement.term),
      );
      const status = !m.evidenceIds.length
        ? "UNSUPPORTED"
        : m.status === "SUPPORTED" && !exact
          ? "PARTIALLY_SUPPORTED"
          : m.status;
      return { ...m, status };
    }),
  };
}

export type ValidationFailure = {
  code: string;
  path: string;
  message: string;
  penalty: number;
};
export type ResumeValidationResult = {
  valid: boolean;
  hardFailures: ValidationFailure[];
  unsupportedClaims: ResumeClaim[];
  missingRequirements: string[];
  score: {
    total: number;
    mustHaveCoverage: number;
    evidenceCoverage: number;
    responsibilityAlignment: number;
    keywordCoverage: number;
    architectureDomainAlignment: number;
    consistency: number;
    structuralQuality: number;
    penalties: number;
  };
};

export function validateEvidenceResume(
  resume: EvidenceResume,
  analysis: JobAnalysis,
  map: EvidenceMap,
  corpus: EvidenceCorpus,
): ResumeValidationResult {
  const hardFailures: ValidationFailure[] = [],
    unsupportedClaims: ResumeClaim[] = [];
  const evidence = new Map(corpus.evidence.map((e) => [e.id, e]));
  const covered = new Set<string>();
  let claimCount = 0,
    supportedCount = 0;
  const fail = (code: string, path: string, message: string, penalty = 0) =>
    hardFailures.push({ code, path, message, penalty });
  const check = (
    c: ResumeClaim,
    path: string,
    kinds: VerifiedEvidence["kind"][],
    entityId?: string,
    context?: VerifiedEvidence["context"],
  ) => {
    claimCount++;
    const before = hardFailures.length;
    const facts = c.evidenceIds.map((id) => evidence.get(id));
    // Deliberately extractive: a valid ID alone cannot prove arbitrary paraphrased text.
    // Exact complete facts also prevent negation deletion and recombined/inverted metrics.
    const matching = facts.filter(
      (e): e is VerifiedEvidence =>
        !!e && e.text === c.text && kinds.includes(e.kind),
    );
    if (
      !matching.length ||
      facts.some((e) => !e) ||
      c.evidenceStatus !== "SUPPORTED"
    ) {
      fail(
        "UNSUPPORTED_CLAIM",
        path,
        "Claim must select a complete verified fact with the correct kind",
      );
      unsupportedClaims.push(c);
      if (/\d/.test(c.text) && !matching.length)
        fail(
          "FABRICATED_METRIC",
          path,
          "Numeric statement differs from its source",
          30,
        );
      if (kinds.includes("skill") || kinds.includes("technology"))
        fail("UNSUPPORTED_TECHNOLOGY", path, "Unverified technology", 20);
    }
    if (
      entityId &&
      !matching.some((e) => e.entityId === entityId && e.context === context)
    ) {
      fail(
        "ENTITY_EVIDENCE_MISMATCH",
        path,
        "Evidence does not belong to this employer/project",
      );
      if (
        context === "commercial" &&
        matching.some((e) => e.context === "personal")
      )
        fail(
          "PERSONAL_TO_COMMERCIAL",
          path,
          "Personal evidence used as commercial work",
          30,
        );
    }
    for (const keyword of c.keywords)
      if (!containsTerm(c.text, keyword))
        fail(
          "INVALID_KEYWORD",
          path,
          `Keyword is absent from the claim: ${keyword}`,
        );
    for (const id of c.requirementIds) {
      const requirement = analysis.requirements.find((r) => r.id === id);
      const mapped = map.requirements.find((r) => r.requirementId === id);
      if (
        !requirement ||
        !mapped ||
        mapped.status === "UNSUPPORTED" ||
        !matching.some((e) => mapped.evidenceIds.includes(e.id))
      )
        fail(
          "INVALID_REQUIREMENT_LINK",
          path,
          `Unverified requirement link: ${id}`,
        );
      // Partial links can explain relevance, but never count as exact coverage.
      else if (
        mapped.status === "SUPPORTED" &&
        containsTerm(c.text, requirement.term) &&
        hardFailures.length === before
      )
        covered.add(id);
    }
    if (hardFailures.length === before) supportedCount++;
  };
  check(resume.targetTitle, "targetTitle", ["title"]);
  if (
    [resume.targetTitle, ...resume.summary].some(
      (c) =>
        /\b(senior|lead|staff|principal)\b/i.test(c.text) &&
        !corpus.evidence.some(
          (e) => ["title", "summary"].includes(e.kind) && e.text === c.text,
        ),
    )
  )
    fail(
      "SENIORITY_UPGRADE",
      "targetTitle/summary",
      "Unsupported seniority",
      15,
    );
  resume.summary.forEach((c, i) => check(c, `summary.${i}`, ["summary"]));
  resume.skills.forEach((group, i) => {
    if (!corpus.categories.includes(group.category))
      fail(
        "UNKNOWN_SKILL_CATEGORY",
        `skills.${i}`,
        "Category must come from the base profile",
      );
    group.items.forEach((c, j) =>
      check(c, `skills.${i}.${j}`, ["skill", "technology"]),
    );
  });
  const seen = new Set<string>();
  for (const [section, context] of [
    ["experience", "commercial"],
    ["projects", "personal"],
  ] as const)
    resume[section].forEach((entry, i) => {
      const path = `${section}.${i}`;
      if (
        !corpus.entityIds[context].includes(entry.entityId) ||
        seen.has(entry.entityId)
      )
        fail(
          "FABRICATED_EMPLOYER_PROJECT",
          path,
          "Unknown, duplicated, or misclassified entity",
        );
      seen.add(entry.entityId);
      check(
        entry.header,
        `${path}.header`,
        ["header"],
        entry.entityId,
        context,
      );
      if (
        !corpus.evidence.some(
          (e) =>
            e.kind === "header" &&
            e.entityId === entry.entityId &&
            e.text === entry.header.text,
        )
      )
        fail(
          "EMPLOYMENT_DATES_OR_IDENTITY_CHANGED",
          path,
          "Header must preserve dates, title, employer/project",
        );
      entry.description.forEach((c, j) =>
        check(
          c,
          `${path}.description.${j}`,
          ["description"],
          entry.entityId,
          context,
        ),
      );
      entry.bullets.forEach((c, j) =>
        check(c, `${path}.bullets.${j}`, ["bullet"], entry.entityId, context),
      );
      entry.technologies.forEach((c, j) =>
        check(
          c,
          `${path}.technologies.${j}`,
          ["technology"],
          entry.entityId,
          context,
        ),
      );
    });
  for (const id of corpus.entityIds.commercial)
    if (!seen.has(id))
      fail(
        "MISSING_EMPLOYMENT",
        "experience",
        "Commercial employment must be retained",
      );
  for (const id of corpus.entityIds.personal) {
    if (!seen.has(id)) {
      fail(
        "MISSING_PERSONAL_PROJECT",
        "projects",
        "Every verified personal project must be retained",
      );
      continue;
    }
    const sourceFacts = corpus.evidence.filter(
      (e) =>
        e.entityId === id &&
        ["description", "bullet", "technology"].includes(e.kind),
    );
    const selectedClaims = resume.projects
      .filter((entry) => entry.entityId === id)
      .flatMap((entry) => [
        ...entry.description,
        ...entry.bullets,
        ...entry.technologies,
      ]);
    for (const sourceFact of sourceFacts)
      if (
        !selectedClaims.some(
          (claim) =>
            claim.text === sourceFact.text &&
            claim.evidenceIds.includes(sourceFact.id),
        )
      )
        fail(
          "INCOMPLETE_PERSONAL_PROJECT",
          "projects",
          `Verified project fact was omitted: ${sourceFact.text}`,
        );
  }
  resume.education.forEach((c, i) => {
    check(c, `education.${i}`, ["education"]);
    if (
      !corpus.evidence.some(
        (e) =>
          e.kind === "education" &&
          e.text === c.text &&
          c.evidenceIds.includes(e.id),
      )
    )
      fail(
        "FAKE_EDUCATION",
        `education.${i}`,
        "Education must match verified evidence",
      );
  });
  for (const sourceEducation of corpus.evidence.filter(
    (e) => e.kind === "education",
  ))
    if (
      !resume.education.some(
        (claim) =>
          claim.text === sourceEducation.text &&
          claim.evidenceIds.includes(sourceEducation.id),
      )
    )
      fail(
        "MISSING_EDUCATION",
        "education",
        `Verified education was omitted: ${sourceEducation.text}`,
      );
  const coverage = (rs: Requirement[]) =>
    rs.length
      ? (100 *
          rs
            .filter((r) => covered.has(r.id))
            .reduce((n, r) => n + r.importance, 0)) /
        rs.reduce((n, r) => n + r.importance, 0)
      : 100;
  const allClaims = [
    resume.targetTitle,
    ...resume.summary,
    ...resume.skills.flatMap((s) => s.items),
    ...resume.experience.flatMap((e) => [
      e.header,
      ...e.description,
      ...e.bullets,
      ...e.technologies,
    ]),
    ...resume.projects.flatMap((e) => [
      e.header,
      ...e.description,
      ...e.bullets,
      ...e.technologies,
    ]),
    ...resume.education,
  ];
  const skillsText = resume.skills
    .flatMap((s) => s.items.map((c) => c.text))
    .join(" ");
  const summaryKeywords = resume.summary.flatMap((c) => c.keywords);
  const consistency = summaryKeywords.length
    ? (100 *
        summaryKeywords.filter((k) => containsTerm(skillsText, k)).length) /
      summaryKeywords.length
    : 100;
  const duplicateCount =
    allClaims.length - new Set(allClaims.map((c) => c.text)).size;
  const structuralQuality = Math.max(
    0,
    100 - duplicateCount * 5 - (resume.summary.length !== 3 ? 10 : 0),
  );
  const score = {
    total: 0,
    mustHaveCoverage: coverage(
      analysis.requirements.filter((r) => r.classification === "MUST_HAVE"),
    ),
    evidenceCoverage: claimCount ? (supportedCount / claimCount) * 100 : 0,
    responsibilityAlignment: coverage(
      analysis.requirements.filter((r) => r.category === "responsibility"),
    ),
    keywordCoverage: coverage(analysis.requirements),
    architectureDomainAlignment: coverage(
      analysis.requirements.filter((r) =>
        ["architecture", "domain"].includes(r.category),
      ),
    ),
    consistency,
    structuralQuality,
    penalties: hardFailures.reduce((n, f) => n + f.penalty, 0),
  };
  score.total = Math.max(
    0,
    Math.round(
      score.mustHaveCoverage * 0.35 +
        score.evidenceCoverage * 0.2 +
        score.responsibilityAlignment * 0.15 +
        score.keywordCoverage * 0.1 +
        score.architectureDomainAlignment * 0.1 +
        consistency * 0.05 +
        structuralQuality * 0.05 -
        score.penalties,
    ),
  );
  return {
    valid: !hardFailures.length,
    hardFailures,
    unsupportedClaims,
    missingRequirements: analysis.requirements
      .filter((r) => !covered.has(r.id))
      .map((r) => r.id),
    score,
  };
}

export function renderEvidenceResume(
  resume: EvidenceResume,
  corpus: EvidenceCorpus,
  validation: ResumeValidationResult,
): string {
  if (!validation.valid)
    throw new Error("Resume rendering requires final deterministic PASS");
  const entries = (values: EvidenceResume["experience"]) =>
    values.flatMap((e) => [
      e.header.text,
      ...e.description.map((c) => c.text),
      ...e.bullets.map((c) => `- ${c.text}`),
      ...(e.technologies.length
        ? [`Technologies: ${e.technologies.map((c) => c.text).join(", ")}`]
        : []),
      "",
    ]);
  return [
    corpus.contactLines[0] ?? "",
    resume.targetTitle.text,
    ...corpus.contactLines.slice(1),
    "",
    "## Summary",
    resume.summary.map((c) => c.text).join(" "),
    "",
    "## Skills",
    ...resume.skills.map(
      (s) => `${s.category}: ${s.items.map((c) => c.text).join(", ")}`,
    ),
    "",
    "## Experience",
    ...entries(resume.experience),
    ...(resume.projects.length
      ? ["## Personal Projects", ...entries(resume.projects)]
      : []),
    "## Education",
    ...resume.education.map((c) => c.text),
  ].join("\n");
}
