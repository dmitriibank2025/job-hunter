import fs from "fs";
import path from "path";
import {
  assignRequirementIds,
  buildEvidenceCorpus,
  renderEvidenceResume,
  stableId,
  validateEvidenceResume,
  verifyEvidenceMap,
  type EvidenceResume,
  type ResumeClaim,
  type VerifiedEvidence,
} from "../services/resume-evidence.service";
import {
  runEvidencePipeline,
  scoreResumePresentation,
  vacancyAnalysisSchema,
  evidenceMappingSchema,
  reconcileClaimMetadata,
} from "../services/resume-pipeline.service";
import { buildRoleResumeVariant } from "../services/resume-role-variant.service";

const base = fs.readFileSync(
  path.join(__dirname, "../data/base-resumes/fullstack.md"),
  "utf8",
);
const corpus = buildEvidenceCorpus(base, "Dmitrii Bank");
const requirement = {
  term: "Node.js",
  normalized: "Node.js",
  category: "backend" as const,
  classification: "MUST_HAVE" as const,
  importance: 10,
  sourceQuote: "Node.js required",
};
const rawAnalysis = {
  targetTitle: "Full Stack Engineer",
  alternativeTitles: [],
  seniority: "mid" as const,
  requirements: [requirement],
};
const analysis = assignRequirementIds(rawAnalysis, "Node.js required");
const fact = (kind: VerifiedEvidence["kind"]) =>
  corpus.evidence.find((e) => e.kind === kind)!;
const claim = (e: VerifiedEvidence): ResumeClaim => ({
  text: e.text,
  evidenceIds: [e.id],
  requirementIds: [],
  keywords: [],
  evidenceStatus: "SUPPORTED",
});
const node = corpus.evidence.find(
  (e) => e.kind === "skill" && e.text === "Node.js",
)!;
const map = {
  requirements: [
    {
      requirementId: analysis.requirements[0].id,
      status: "SUPPORTED" as const,
      evidenceIds: [node.id],
      confidence: 1,
      reason: "Verified base skill",
    },
  ],
};
function makeResume(): EvidenceResume {
  const entries = (context: "commercial" | "personal") =>
    corpus.entityIds[context].map((entityId) => {
      const facts = corpus.evidence.filter((e) => e.entityId === entityId);
      return {
        entityId,
        header: claim(facts.find((e) => e.kind === "header")!),
        description: facts.filter((e) => e.kind === "description").map(claim),
        bullets: facts
          .filter((e) => e.kind === "bullet")
          .slice(0, 3)
          .map(claim),
        technologies: facts.filter((e) => e.kind === "technology").map(claim),
      };
    });
  return {
    targetTitle: claim(fact("title")),
    summary: corpus.evidence
      .filter((e) => e.kind === "summary")
      .slice(0, 3)
      .map(claim),
    skills: [
      {
        category: "Backend",
        items: [
          {
            ...claim(node),
            requirementIds: [analysis.requirements[0].id],
            keywords: ["Node.js"],
          },
        ],
      },
    ],
    experience: entries("commercial"),
    projects: entries("personal"),
    education: [claim(fact("education"))],
  };
}
const validate = (resume: EvidenceResume) =>
  validateEvidenceResume(resume, analysis, map, corpus);

describe("verified evidence and deterministic validation", () => {
  test("rendered header separates legacy city and retains the complete verified stack", () => {
    const resume = makeResume();
    const rendered = renderEvidenceResume(resume, corpus, validate(resume));
    expect(rendered.split("\n")[0]).toBe("DMITRII BANK");
    expect(rendered.split("\n")[1]).toContain("Node.js");
    expect(rendered.split("\n")[1]).toContain("React");
    expect(rendered.split("\n").slice(2).join("\n")).toContain("Rishon LeZion");
  });
  test.each(["BACKEND", "FRONTEND"] as const)("%s variant preserves the exact source fact set", target => {
    const variant = buildEvidenceCorpus(buildRoleResumeVariant(base, target), "Dmitrii Bank");
    expect(variant.evidence.map(e => e.id).sort()).toEqual(corpus.evidence.map(e => e.id).sort());
    expect(variant.entityIds).toEqual(corpus.entityIds);
  });
  test("pipe-delimited contact lines are not candidate titles", () => {
    const contact = "Rishon LeZion, Israel | +972-53-500-21-68 | dmitrii.bank.dev@gmail.com";
    const parsed = buildEvidenceCorpus(base.replace("SUMMARY", `${contact}\nSUMMARY`), "Dmitrii Bank");
    expect(parsed.contactLines).toContain(contact);
    expect(parsed.evidence.filter(e => e.kind === "title")).toHaveLength(1);
  });
  test("mapper contract requires every distinct requirement key", () => {
    const schema = evidenceMappingSchema(["a", "b"], [node.id]);
    const { requirementId, ...assessment } = map.requirements[0];
    expect(schema.safeParse({ requirements: { a: assessment, b: assessment } }).success).toBe(true);
    expect(schema.safeParse({ requirements: { a: assessment } }).success).toBe(false);
  });
  test("metadata repair removes bad annotations but never repairs unsupported claims", () => {
    const resume = makeResume();
    resume.skills[0].items[0].keywords.push("Kafka");
    resume.skills[0].items[0].requirementIds.push("invented");
    expect(reconcileClaimMetadata(resume, map, corpus)).toHaveLength(1);
    expect(validate(resume).valid).toBe(true);
    resume.education[0].text = "Fake degree";
    reconcileClaimMetadata(resume, map, corpus);
    expect(validate(resume).valid).toBe(false);
  });
  test("analyzer schema permits only original citations, not rewritten list items", () => {
    const quote = "Strong knowledge in backend development using Python, Node.js, or Go.";
    const schema = vacancyAnalysisSchema({ title: "Full Stack Engineer", description: quote });
    expect(schema.safeParse({ ...rawAnalysis, requirements: [{ ...requirement, sourceQuote: quote }] }).success).toBe(true);
    expect(schema.safeParse({ ...rawAnalysis, requirements: [{ ...requirement, sourceQuote: "Strong knowledge in backend development using Node.js" }] }).success).toBe(false);
  });
  test("backend/frontend focus annotations do not change verified employment identity", () => {
    const focused = buildEvidenceCorpus(base.replace("2024 – Present | Full Stack Developer", "2024 – Present | Full Stack Developer (Backend Focus)"), "Dmitrii Bank");
    expect(focused.entityIds.commercial).toEqual(corpus.entityIds.commercial);
  });
  test("paraphrased compound requirements retain the exact employer quotation", () => {
    const quote = "Software fundamentals, including testing and code review";
    const result = assignRequirementIds({ ...rawAnalysis, requirements: [{ ...requirement, term: "software fundamentals including testing", sourceQuote: quote }] }, quote);
    expect(result.requirements[0].term).toBe(quote);
  });
  test("plain DOCX paragraphs retain commercial bullet ownership", () => {
    const extracted = buildEvidenceCorpus(
      base.replace(/^• /gm, ""),
      "Dmitrii Bank",
    );
    expect(
      extracted.evidence
        .filter((e) => e.kind === "bullet" && e.context === "commercial")
        .map((e) => e.text),
    ).toEqual(
      corpus.evidence
        .filter((e) => e.kind === "bullet" && e.context === "commercial")
        .map((e) => e.text),
    );
  });
  test("explicit AI policy rejects a contradictory legacy source fact", () => {
    const resume = makeResume();
    const unsafe = structuredClone(corpus);
    const evidenceId = resume.projects[0].bullets[0].evidenceIds[0];
    const text = "Implemented MCP Resources and MCP Prompts.";
    unsafe.evidence.find((e) => e.id === evidenceId)!.text = text;
    resume.projects[0].bullets[0].text = text;
    const result = validateEvidenceResume(resume, analysis, map, unsafe);
    expect(result.valid).toBe(false);
    expect(
      result.hardFailures.some((f) => f.code === "PROHIBITED_AI_CLAIM"),
    ).toBe(true);
  });
  test("current source education is retained without injecting a historical degree", () => {
    expect(corpus.entityIds.commercial).toHaveLength(2);
    expect(
      corpus.evidence.some((e) => /AVSD|Master's degree|Tel-Ran/.test(e.text)),
    ).toBe(false);
    expect(fact("education").text).toContain("D.M.D., Dental Medicine");
    expect(fact("summary").text).toContain("4+ years of commercial experience");
    const other = buildEvidenceCorpus(base, "Someone Else");
    expect(other.evidence.some((e) => /Dental Medicine/.test(e.text))).toBe(
      true,
    );
    expect(() =>
      buildEvidenceCorpus(
        base.replace(
          "2024 – Present | Full Stack Developer",
          "2023 – Present | Full Stack Developer",
        ),
        "Dmitrii Bank",
      ),
    ).toThrow("dates/title");
  });
  test("stable IDs survive reordering; invented requirements and contradictory classification fail", () => {
    expect(stableId("req", " Node.js ", "backend")).toBe(
      stableId("req", "node.js", "backend"),
    );
    expect(
      assignRequirementIds(
        { ...rawAnalysis, requirements: [requirement, requirement] },
        "Node.js required",
      ).requirements,
    ).toHaveLength(1);
    expect(() => assignRequirementIds(rawAnalysis, "React required")).toThrow(
      "Ungrounded",
    );
    expect(() =>
      assignRequirementIds(
        {
          ...rawAnalysis,
          requirements: [
            requirement,
            { ...requirement, classification: "NICE_TO_HAVE" },
          ],
        },
        "Node.js required",
      ),
    ).toThrow("Conflicting");
  });
  test("validity is independent of fit score", () => {
    const resume = makeResume();
    expect(validate(resume).valid).toBe(true);
    const unmatched = {
      requirements: [
        {
          ...map.requirements[0],
          status: "UNSUPPORTED" as const,
          evidenceIds: [],
        },
      ],
    };
    resume.skills[0].items[0].requirementIds = [];
    const result = validateEvidenceResume(resume, analysis, unmatched, corpus);
    expect(result.valid).toBe(true);
    expect(result.score.mustHaveCoverage).toBe(0);
    expect(result.score.total).toBeLessThan(100);
  });
  test.each([
    "Kafka",
    "Built 999 endpoints",
    "Removed all security checks",
    "Built MCP Resources and Prompts",
  ])("real evidence IDs cannot launder unsupported text: %s", (text) => {
    const resume = makeResume();
    resume.experience[0].bullets[0].text = text;
    const result = validate(resume);
    expect(result.valid).toBe(false);
    expect(result.unsupportedClaims).toHaveLength(1);
    expect(() => renderEvidenceResume(resume, corpus, result)).toThrow("PASS");
  });
  test("fabricated skills get -20 and metrics get -30", () => {
    const resume = makeResume();
    resume.skills[0].items[0].text = "Kafka";
    resume.experience[0].bullets[0].text = "Built 999 endpoints";
    const result = validate(resume);
    expect(result.score.penalties).toBe(50);
    expect(result.valid).toBe(false);
  });
  test("employer, project, dates, education and seniority changes hard-fail", () => {
    const resume = makeResume();
    resume.experience[0].entityId = "invented";
    resume.experience[1].header.text = resume.experience[1].header.text.replace(
      "2022",
      "2020",
    );
    resume.education[0].text = "PhD, MIT";
    resume.targetTitle.text = "Senior Full Stack Engineer";
    const result = validate(resume);
    expect(result.valid).toBe(false);
    expect(result.hardFailures.map((f) => f.code)).toEqual(
      expect.arrayContaining([
        "FABRICATED_EMPLOYER_PROJECT",
        "EMPLOYMENT_DATES_OR_IDENTITY_CHANGED",
        "FAKE_EDUCATION",
        "SENIORITY_UPGRADE",
      ]),
    );
  });
  test("personal AI evidence cannot move into commercial employment", () => {
    const resume = makeResume();
    resume.experience[0].bullets[0] = resume.projects[0].bullets[0];
    const result = validate(resume);
    expect(result.valid).toBe(false);
    expect(
      result.hardFailures.some(
        (f) => f.code === "PERSONAL_TO_COMMERCIAL" && f.penalty === 30,
      ),
    ).toBe(true);
  });
  test("cross-employer evidence and foreign IDs are rejected", () => {
    const resume = makeResume();
    resume.experience[0].bullets[0] = resume.experience[1].bullets[0];
    resume.summary[0].evidenceIds = ["another-user-evidence"];
    resume.skills[0].items[0].requirementIds = ["unknown-requirement"];
    expect(validate(resume).valid).toBe(false);
  });
  test("SQS is truthful partial support for Kafka, never exact coverage", () => {
    const sqs = corpus.evidence.find(
      (e) => e.kind === "bullet" && e.text.includes("SQS"),
    )!;
    const kafka = assignRequirementIds(
      {
        ...rawAnalysis,
        requirements: [
          { ...requirement, term: "Kafka", sourceQuote: "Kafka required" },
        ],
      },
      "Kafka required",
    );
    const partial = verifyEvidenceMap(
      {
        requirements: [
          {
            ...map.requirements[0],
            requirementId: kafka.requirements[0].id,
            evidenceIds: [sqs.id],
          },
        ],
      },
      kafka,
      corpus.evidence,
    );
    expect(partial.requirements[0].status).toBe("PARTIALLY_SUPPORTED");
    const resume = makeResume();
    resume.skills[0].items[0].requirementIds = [];
    resume.experience[0].bullets = [
      { ...claim(sqs), requirementIds: [kafka.requirements[0].id] },
    ];
    const result = validateEvidenceResume(resume, kafka, partial, corpus);
    expect(result.valid).toBe(true);
    expect(result.score.mustHaveCoverage).toBe(0);
    resume.experience[0].bullets[0].text = "Built workflows using Kafka";
    expect(validateEvidenceResume(resume, kafka, partial, corpus).valid).toBe(
      false,
    );
  });
  test("map rejects missing/duplicate/unknown references", () => {
    expect(() =>
      verifyEvidenceMap({ requirements: [] }, analysis, corpus.evidence),
    ).toThrow();
    expect(() =>
      verifyEvidenceMap(
        { requirements: [map.requirements[0], map.requirements[0]] },
        analysis,
        corpus.evidence,
      ),
    ).toThrow();
    expect(() =>
      verifyEvidenceMap(
        {
          requirements: [{ ...map.requirements[0], evidenceIds: ["foreign"] }],
        },
        analysis,
        corpus.evidence,
      ),
    ).toThrow();
  });
  test("presentation score never claims factual validity", () => {
    expect(
      scoreResumePresentation("## Summary\nInvented Kafka experience")
        .factualValidity,
    ).toBe("NOT_EVALUATED");
  });
});

describe("pipeline stages and fail-closed repair", () => {
  const input = {
    vacancy: { title: "Full Stack Engineer", description: "Node.js required" },
    baseResume: base,
    fullName: "Dmitrii Bank",
  };
  function deps(
    generator = makeResume(),
    repair = makeResume(),
    critiqueRepair = false,
  ) {
    const stages: string[] = [];
    const complete = jest.fn(
      async (_system, _input, _schema, stage: string): Promise<unknown> => {
        stages.push(stage);
        if (stage === "analyzer") return rawAnalysis;
        if (stage === "planner")
          return {
            queries: [
              {
                requirementId: analysis.requirements[0].id,
                query: "Commercial Node.js backend APIs",
                topK: 4,
              },
            ],
          };
        if (stage === "mapper") return { requirements: Object.fromEntries(map.requirements.map(({ requirementId, ...assessment }) => [requirementId, assessment])) };
        if (stage === "generator") return generator;
        if (stage === "repair") return repair;
        return {
          issues: [],
          strengths: ["Concrete"],
          recommendedChanges: [],
          needsRepair:
            critiqueRepair && stages.filter((s) => s === "critic").length === 1,
        };
      },
    );
    return {
      stages,
      complete,
      searchExperience: jest.fn(async () => [
        { id: "db-id", source: node.source, text: node.text, distance: 0.01 },
      ]),
    };
  }
  test("critic runs after PASS and final result retains full provenance", async () => {
    const mock = deps();
    const result = await runEvidencePipeline(input, mock);
    expect(mock.stages).toEqual([
      "analyzer",
      "planner",
      "mapper",
      "generator",
      "critic",
    ]);
    expect(result.validation.valid).toBe(true);
    expect(result.retrieval[0].admittedEvidenceIds).toContain(node.id);
    expect(result.content).toContain("D.M.D., Dental Medicine");
    expect(result.content).not.toContain("AVSD+");
  });
  test("quality issues on PASS trigger repair and revalidation", async () => {
    const mock = deps(makeResume(), makeResume(), true);
    const result = await runEvidencePipeline(input, mock);
    expect(mock.stages.slice(-3)).toEqual(["critic", "repair", "critic"]);
    expect(result.attempts).toHaveLength(2);
  });
  test("repair fixes FAIL, then validates and critiques again", async () => {
    const invalid = makeResume();
    invalid.education[0].text = "Fake degree";
    const result = await runEvidencePipeline(input, deps(invalid));
    expect(result.attempts[0].validation.valid).toBe(false);
    expect(result.validation.valid).toBe(true);
  });
  test("repair regression or exhausted repair never returns a final resume", async () => {
    const invalid = makeResume();
    invalid.skills[0].items[0].text = "Kafka";
    await expect(
      runEvidencePipeline(
        { ...input, maxRepairs: 1 },
        deps(makeResume(), invalid, true),
      ),
    ).rejects.toThrow("validation FAIL");
    await expect(
      runEvidencePipeline({ ...input, maxRepairs: 0 }, deps(invalid)),
    ).rejects.toThrow("validation FAIL");
    await expect(
      runEvidencePipeline(
        { ...input, maxRepairs: 0 },
        deps(makeResume(), makeResume(), true),
      ),
    ).rejects.toThrow("qualitative review unresolved");
  });
  test("retrieval failure propagates without generating or rendering", async () => {
    const mock = deps();
    mock.searchExperience.mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    await expect(runEvidencePipeline(input, mock)).rejects.toThrow(
      "database unavailable",
    );
    expect(mock.stages).toEqual(["analyzer", "planner"]);
  });
  test("malformed model outputs fail closed", async () => {
    const mock = deps();
    mock.complete.mockResolvedValueOnce({ targetTitle: "Engineer" });
    await expect(runEvidencePipeline(input, mock)).rejects.toThrow();
    expect(mock.searchExperience).not.toHaveBeenCalled();
  });
});
