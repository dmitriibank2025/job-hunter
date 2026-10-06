import {
  CandidateExperienceType,
  CandidateFactEntityType,
  CandidateFactKind,
  CandidateProjectType,
  ResumeBaseMode,
  ResumeBaseStatus,
  ResumeBaseTarget,
} from "@prisma/client";
import { prisma } from "../infrastructure/prisma";

export type CandidateContext = {
  userId: string;
  revision: number;
  profile: {
    id: string;
    fullName: string;
    email: string;
    location: string | null;
    phone: string | null;
    linkedin: string | null;
    github: string | null;
    portfolio: string | null;
    languages: string[];
    summary: string | null;
  };
  technologies: Array<{ id: string; name: string; category: string; level: string | null }>;
  experiences: Array<{
    id: string;
    type: CandidateExperienceType;
    company: string;
    title: string;
    location: string | null;
    startDate: string;
    endDate: string | null;
    project: string | null;
    description: string | null;
    bullets: string[];
    technologies: string[];
  }>;
  projects: Array<{
    id: string;
    type: CandidateProjectType;
    name: string;
    role: string | null;
    url: string | null;
    startDate: string | null;
    endDate: string | null;
    description: string | null;
    bullets: string[];
    technologies: string[];
  }>;
  education: Array<{
    id: string;
    institution: string;
    program: string;
    location: string | null;
    startDate: string | null;
    endDate: string | null;
    details: string[];
  }>;
  facts: Array<{
    id: string;
    entityType: CandidateFactEntityType;
    entityId: string;
    kind: CandidateFactKind;
    text: string;
    verified: boolean;
    revision: number;
  }>;
  selectedBase: {
    id: string;
    name: string;
    target: ResumeBaseTarget;
    targetTitle: string | null;
    content: string;
    sourceFilePath: string | null;
    mode: ResumeBaseMode;
    sourceRevision: number | null;
    definition: unknown;
    renderStatus: ResumeBaseStatus;
  };
};

/** Load one immutable, user-scoped snapshot for every downstream AI stage. */
export async function getCandidateContext(userId: string, resumeBaseId?: string): Promise<CandidateContext> {
  const user = await prisma.appUser.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      candidateRevision: true,
      profile: {
        select: {
          id: true,
          fullName: true,
          email: true,
          location: true,
          phone: true,
          linkedin: true,
          github: true,
          portfolio: true,
          languages: true,
          summary: true,
        },
      },
      technologies: { orderBy: [{ category: "asc" }, { name: "asc" }] },
      experiences: { orderBy: [{ sortOrder: "asc" }, { startDate: "desc" }] },
      projects: { orderBy: [{ sortOrder: "asc" }, { startDate: "desc" }] },
      educations: { orderBy: [{ sortOrder: "asc" }, { endDate: "desc" }] },
      candidateFacts: { where: { verified: true }, orderBy: { createdAt: "asc" } },
      resumeBases: {
        where: resumeBaseId ? { id: resumeBaseId } : undefined,
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
        take: 1,
      },
    },
  });
  if (!user.profile) throw new Error("Complete the user profile before analyzing jobs or generating resumes.");
  const selectedBase = user.resumeBases[0];
  if (!selectedBase) {
    throw new Error(resumeBaseId
      ? "Selected base resume was not found for this user."
      : "Create at least one base resume before analyzing jobs or generating resumes.");
  }
  const facts = user.candidateFacts.filter((fact) => fact.revision === user.candidateRevision);
  if (!facts.length) throw new Error("Candidate facts are missing for the current revision. Save the profile or run the candidate-facts backfill.");

  return {
    userId: user.id,
    revision: user.candidateRevision,
    profile: user.profile,
    technologies: user.technologies,
    experiences: user.experiences,
    projects: user.projects,
    education: user.educations,
    facts,
    selectedBase,
  };
}

/** Deterministic prompt representation; facts remain structured and user-scoped. */
export function renderCandidateContextForPrompt(context: CandidateContext): string {
  const factsFor = (entityId: string) => context.facts
    .filter((fact) => fact.entityId === entityId && fact.kind !== "CONTACT")
    .map((fact) => `- [${fact.id}/${fact.kind}] ${fact.text}`);
  const sections = [
    `CANDIDATE REVISION: ${context.revision}`,
    `TARGET: ${context.selectedBase.targetTitle ?? context.selectedBase.target}`,
    "PROFILE",
    ...context.facts
      .filter((fact) => fact.entityType === "PROFILE" && fact.kind === "SUMMARY")
      .map((fact) => `- [${fact.id}/SUMMARY] ${fact.text}`),
    "SKILLS",
    ...context.technologies.map((technology) => `- ${technology.category}: ${technology.name}`),
    "COMMERCIAL EXPERIENCE",
    ...context.experiences.flatMap((experience) => factsFor(experience.id)),
    "PERSONAL PROJECTS",
    ...context.projects.flatMap((project) => factsFor(project.id)),
    "EDUCATION",
    ...context.education.flatMap((education) => factsFor(education.id)),
  ];
  return sections.join("\n");
}

export function hasStructuredCandidateEvidence(context: CandidateContext) {
  // Uploaded snapshots remain on the audited legacy adapter until their facts
  // are explicitly imported; otherwise projects present only in the file could
  // silently disappear. Newly generated LINKED bases always use canonical data.
  return context.selectedBase.mode === "LINKED" && context.facts.some((fact) =>
    ["TECHNOLOGY", "EXPERIENCE", "PROJECT", "EDUCATION"].includes(fact.entityType),
  );
}
