jest.mock("../infrastructure/prisma", () => ({ prisma: {} }));

import { buildCanonicalCandidateFacts } from "../services/candidate-facts.service";

function source(userId = "user-a") {
  return {
    id: userId,
    profile: {
      id: "profile-1",
      fullName: "Alex Example",
      location: "Tel Aviv",
      phone: null,
      email: "alex@example.com",
      linkedin: null,
      github: null,
      portfolio: null,
      languages: ["English"],
      summary: "Backend engineer building reliable APIs.",
    },
    technologies: [{ name: "TypeScript" }, { name: "PostgreSQL" }],
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
      bullets: ["Built reliable APIs.", "Reduced duplicate processing."],
      technologies: ["TypeScript", "PostgreSQL"],
    }],
    projects: [{
      id: "project-1",
      type: "PERSONAL",
      name: "Search Assistant",
      role: null,
      url: null,
      startDate: "2026",
      endDate: null,
      description: "A personal retrieval project.",
      bullets: ["Implemented semantic retrieval."],
      technologies: ["pgvector"],
    }],
    educations: [{
      id: "education-1",
      institution: "Example University",
      program: "MSc Computer Science",
      location: null,
      startDate: null,
      endDate: "2022",
      details: [],
    }],
  };
}

describe("canonical candidate facts", () => {
  it("keeps IDs stable when lists are reordered", () => {
    const first = source();
    const reordered = source();
    reordered.technologies.reverse();
    reordered.experiences[0].bullets.reverse();

    const ids = buildCanonicalCandidateFacts(first).map((fact) => fact.id).sort();
    const reorderedIds = buildCanonicalCandidateFacts(reordered).map((fact) => fact.id).sort();

    expect(reorderedIds).toEqual(ids);
  });

  it("changes only the edited fact identity", () => {
    const before = buildCanonicalCandidateFacts(source());
    const edited = source();
    edited.experiences[0].bullets[0] = "Built reliable REST APIs.";
    const after = buildCanonicalCandidateFacts(edited);

    expect(after.find((fact) => fact.text === "Reduced duplicate processing.")?.id)
      .toBe(before.find((fact) => fact.text === "Reduced duplicate processing.")?.id);
    expect(after.find((fact) => fact.text === "Built reliable REST APIs.")?.id)
      .not.toBe(before.find((fact) => fact.text === "Built reliable APIs.")?.id);
  });

  it("namespaces fact IDs by user", () => {
    const first = buildCanonicalCandidateFacts(source("user-a"));
    const second = buildCanonicalCandidateFacts(source("user-b"));
    const firstTypescript = first.find((fact) => fact.text === "TypeScript" && fact.entityType === "TECHNOLOGY");
    const secondTypescript = second.find((fact) => fact.text === "TypeScript" && fact.entityType === "TECHNOLOGY");

    expect(firstTypescript?.id).toBeDefined();
    expect(firstTypescript?.id).not.toBe(secondTypescript?.id);
  });

  it("keeps personal projects separate from commercial experience", () => {
    const facts = buildCanonicalCandidateFacts(source());

    expect(facts.some((fact) => fact.entityType === "EXPERIENCE" && fact.text.includes("Example Ltd"))).toBe(true);
    expect(facts.some((fact) => fact.entityType === "PROJECT" && fact.text.includes("Search Assistant"))).toBe(true);
    expect(facts.some((fact) => fact.entityType === "EXPERIENCE" && fact.text.includes("Search Assistant"))).toBe(false);
  });
});
