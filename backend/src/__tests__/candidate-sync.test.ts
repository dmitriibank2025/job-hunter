jest.mock("../infrastructure/prisma", () => ({ prisma: {} }));

import {
  assertExpectedCandidateRevision,
  buildResumeContent,
} from "../services/user-workspace.service";

describe("candidate data synchronization", () => {
  it("rejects stale optimistic-concurrency revisions", () => {
    expect(() => assertExpectedCandidateRevision(4, 5)).toThrow(
      "expected revision 4, current revision 5",
    );
    expect(() => assertExpectedCandidateRevision(5, 5)).not.toThrow();
    expect(() => assertExpectedCandidateRevision(undefined, 5)).not.toThrow();
  });

  it("projects current structured data into a complete base resume", () => {
    const content = buildResumeContent({
      profile: {
        fullName: "Alex Example",
        email: "alex@example.com",
        summary: "Current user-authored summary.",
      },
      technologies: ["TypeScript", "PostgreSQL"],
      targetTitle: "Backend Engineer",
      experiences: [{
        company: "Current Company",
        title: "Backend Engineer",
        startDate: "2025",
        endDate: null,
        description: "Current commercial experience.",
        bullets: ["Built a current API."],
        technologies: ["TypeScript"],
      }],
      projects: [{
        name: "Current Personal Project",
        startDate: "2026",
        endDate: null,
        description: "Current project description.",
        bullets: ["Implemented current retrieval."],
        technologies: ["pgvector"],
      }],
      educations: [{
        institution: "Current University",
        program: "MSc Computer Science",
        endDate: "2024",
        details: [],
      }],
    });

    expect(content).toContain("Current Company");
    expect(content).toContain("## Personal Projects");
    expect(content).toContain("Current Personal Project");
    expect(content).toContain("Current University");
    expect(content).not.toContain("Optimadevs");
  });
});
