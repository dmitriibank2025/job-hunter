import type { CandidateContext } from "../services/candidate-context.service";
import { renderCandidateContextForPrompt } from "../services/candidate-context.service";
import { buildEvidenceCorpusFromCandidateContext } from "../services/resume-evidence.service";

const context: CandidateContext = {
  userId: "user-1",
  revision: 8,
  profile: {
    id: "profile-1",
    fullName: "Alex Example",
    email: "alex@example.com",
    location: "Tel Aviv",
    phone: null,
    linkedin: null,
    github: null,
    portfolio: null,
    languages: ["English"],
    summary: "Backend engineer building reliable APIs.",
  },
  technologies: [{ id: "technology-1", name: "TypeScript", category: "Languages", level: null }],
  experiences: [{
    id: "experience-1",
    type: "COMMERCIAL",
    company: "Example Ltd",
    title: "Backend Engineer",
    location: "Tel Aviv",
    startDate: "2024",
    endDate: null,
    project: null,
    description: null,
    bullets: ["Built reliable APIs."],
    technologies: ["TypeScript"],
  }],
  projects: [{
    id: "project-1",
    type: "PERSONAL",
    name: "Personal Search",
    role: null,
    url: null,
    startDate: "2026",
    endDate: null,
    description: null,
    bullets: ["Implemented semantic retrieval."],
    technologies: ["pgvector"],
  }],
  education: [{
    id: "education-1",
    institution: "Example University",
    program: "MSc Computer Science",
    location: null,
    startDate: null,
    endDate: "2023",
    details: [],
  }],
  facts: [
    { id: "fact-summary", entityType: "PROFILE", entityId: "profile-1", kind: "SUMMARY", text: "Backend engineer building reliable APIs.", verified: true, revision: 8 },
    { id: "fact-skill", entityType: "TECHNOLOGY", entityId: "typescript", kind: "TECHNOLOGY", text: "TypeScript", verified: true, revision: 8 },
    { id: "fact-exp-header", entityType: "EXPERIENCE", entityId: "experience-1", kind: "HEADER", text: "2024 – Present | Backend Engineer | Example Ltd | Tel Aviv", verified: true, revision: 8 },
    { id: "fact-exp-bullet", entityType: "EXPERIENCE", entityId: "experience-1", kind: "BULLET", text: "Built reliable APIs.", verified: true, revision: 8 },
    { id: "fact-project-header", entityType: "PROJECT", entityId: "project-1", kind: "HEADER", text: "2026 – Present | Personal Search", verified: true, revision: 8 },
    { id: "fact-project-bullet", entityType: "PROJECT", entityId: "project-1", kind: "BULLET", text: "Implemented semantic retrieval.", verified: true, revision: 8 },
    { id: "fact-education", entityType: "EDUCATION", entityId: "education-1", kind: "EDUCATION", text: "2023 | MSc Computer Science | Example University", verified: true, revision: 8 },
  ],
  selectedBase: {
    id: "base-1",
    name: "Backend",
    target: "BACKEND",
    targetTitle: "Backend Engineer",
    content: "STALE SNAPSHOT CONTENT MUST NOT BECOME EVIDENCE",
    sourceFilePath: null,
    mode: "LINKED",
    sourceRevision: 8,
    definition: {},
    renderStatus: "CURRENT",
  },
};

describe("structured candidate context evidence", () => {
  it("uses canonical fact IDs and preserves commercial/project boundaries", () => {
    const corpus = buildEvidenceCorpusFromCandidateContext(context);

    expect(corpus.evidence.map((fact) => fact.id)).toEqual(
      expect.arrayContaining(context.facts.map((fact) => fact.id)),
    );
    expect(corpus.evidence.find((fact) => fact.id === "fact-exp-bullet")).toMatchObject({ context: "commercial", entityId: "experience-1" });
    expect(corpus.evidence.find((fact) => fact.id === "fact-project-bullet")).toMatchObject({ context: "personal", entityId: "project-1" });
    expect(corpus.evidence.some((fact) => fact.text.includes("STALE SNAPSHOT"))).toBe(false);
  });

  it("renders analyzer input from current facts instead of base content", () => {
    const rendered = renderCandidateContextForPrompt(context);

    expect(rendered).toContain("CANDIDATE REVISION: 8");
    expect(rendered).toContain("fact-exp-bullet");
    expect(rendered).toContain("Implemented semantic retrieval.");
    expect(rendered).not.toContain("STALE SNAPSHOT CONTENT");
  });
});
