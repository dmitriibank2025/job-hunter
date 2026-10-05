import { createHash } from "crypto";
import {
  CandidateFactEntityType,
  CandidateFactKind,
  Prisma,
} from "@prisma/client";
import { prisma } from "../infrastructure/prisma";

type CandidateFactDraft = {
  entityType: CandidateFactEntityType;
  entityId: string;
  kind: CandidateFactKind;
  text: string;
  verified?: boolean;
};

type CandidateFactSource = {
  id: string;
  profile: {
    id: string;
    fullName: string;
    location: string | null;
    phone: string | null;
    email: string;
    linkedin: string | null;
    github: string | null;
    portfolio: string | null;
    languages: string[];
    summary: string | null;
  } | null;
  technologies: Array<{ name: string }>;
  experiences: Array<{
    id: string;
    type: string;
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
    type: string;
    name: string;
    role: string | null;
    url: string | null;
    startDate: string | null;
    endDate: string | null;
    description: string | null;
    bullets: string[];
    technologies: string[];
  }>;
  educations: Array<{
    id: string;
    institution: string;
    program: string;
    location: string | null;
    startDate: string | null;
    endDate: string | null;
    details: string[];
  }>;
};

export type CanonicalCandidateFact = CandidateFactDraft & {
  id: string;
  fingerprint: string;
};

const clean = (value: string | null | undefined) => value?.replace(/\s+/g, " ").trim() ?? "";
const dateRange = (start?: string | null, end?: string | null) =>
  !clean(start) && !clean(end) ? "" : [clean(start), clean(end) || "Present"].filter(Boolean).join(" – ");

function fingerprintFact(userId: string, fact: CandidateFactDraft) {
  return createHash("sha256")
    .update([userId, fact.entityType, fact.entityId, fact.kind, clean(fact.text).toLocaleLowerCase("en-US")].join("\u001f"))
    .digest("hex");
}

/** Build deterministic facts from structured user-owned records. */
export function buildCanonicalCandidateFacts(source: CandidateFactSource): CanonicalCandidateFact[] {
  const drafts: CandidateFactDraft[] = [];
  const add = (fact: CandidateFactDraft) => {
    const text = clean(fact.text);
    if (text) drafts.push({ ...fact, text, verified: fact.verified ?? true });
  };

  if (source.profile) {
    const profile = source.profile;
    for (const value of [
      profile.fullName,
      profile.location,
      profile.phone,
      profile.email,
      profile.linkedin,
      profile.github,
      profile.portfolio,
      ...profile.languages,
    ]) {
      if (value) add({ entityType: "PROFILE", entityId: profile.id, kind: "CONTACT", text: value });
    }
    if (profile.summary)
      add({ entityType: "PROFILE", entityId: profile.id, kind: "SUMMARY", text: profile.summary });
  }

  for (const technology of source.technologies) {
    const name = clean(technology.name);
    if (name)
      add({ entityType: "TECHNOLOGY", entityId: name.toLocaleLowerCase("en-US"), kind: "TECHNOLOGY", text: name });
  }

  for (const experience of source.experiences) {
    add({
      entityType: "EXPERIENCE",
      entityId: experience.id,
      kind: "HEADER",
      text: [dateRange(experience.startDate, experience.endDate), experience.title, experience.company, experience.location]
        .filter(Boolean)
        .join(" | "),
    });
    if (experience.project)
      add({ entityType: "EXPERIENCE", entityId: experience.id, kind: "DESCRIPTION", text: `Project: ${experience.project}` });
    if (experience.description)
      add({ entityType: "EXPERIENCE", entityId: experience.id, kind: "DESCRIPTION", text: experience.description });
    for (const bullet of experience.bullets)
      add({ entityType: "EXPERIENCE", entityId: experience.id, kind: "BULLET", text: bullet });
    for (const technology of experience.technologies)
      add({ entityType: "EXPERIENCE", entityId: experience.id, kind: "TECHNOLOGY", text: technology });
  }

  for (const project of source.projects) {
    add({
      entityType: "PROJECT",
      entityId: project.id,
      kind: "HEADER",
      text: [dateRange(project.startDate, project.endDate), project.name, project.role, project.url]
        .filter(Boolean)
        .join(" | "),
    });
    if (project.description)
      add({ entityType: "PROJECT", entityId: project.id, kind: "DESCRIPTION", text: project.description });
    for (const bullet of project.bullets)
      add({ entityType: "PROJECT", entityId: project.id, kind: "BULLET", text: bullet });
    for (const technology of project.technologies)
      add({ entityType: "PROJECT", entityId: project.id, kind: "TECHNOLOGY", text: technology });
  }

  for (const education of source.educations) {
    add({
      entityType: "EDUCATION",
      entityId: education.id,
      kind: "EDUCATION",
      text: [
        dateRange(education.startDate, education.endDate),
        education.program,
        education.institution,
        education.location,
      ].filter(Boolean).join(" | "),
    });
    for (const detail of education.details)
      add({ entityType: "EDUCATION", entityId: education.id, kind: "EDUCATION", text: detail });
  }

  const facts = new Map<string, CanonicalCandidateFact>();
  for (const draft of drafts) {
    const fingerprint = fingerprintFact(source.id, draft);
    facts.set(fingerprint, { ...draft, id: `fact_${fingerprint.slice(0, 32)}`, fingerprint });
  }
  return [...facts.values()];
}

/**
 * Increment the candidate revision and replace its derived facts atomically.
 * Call this in the same transaction as every structured candidate-data write.
 */
export async function refreshCandidateFactsInTransaction(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<number> {
  const user = await tx.appUser.update({
    where: { id: userId },
    data: { candidateRevision: { increment: 1 } },
    select: { candidateRevision: true },
  });
  const source = await tx.appUser.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      profile: true,
      technologies: { select: { name: true } },
      experiences: { orderBy: [{ sortOrder: "asc" }, { startDate: "desc" }] },
      projects: { orderBy: [{ sortOrder: "asc" }, { startDate: "desc" }] },
      educations: { orderBy: [{ sortOrder: "asc" }, { endDate: "desc" }] },
    },
  });
  const facts = buildCanonicalCandidateFacts(source);
  const factIds = facts.map((fact) => fact.id);
  await tx.candidateFact.deleteMany({
    where: { userId, ...(factIds.length ? { id: { notIn: factIds } } : {}) },
  });
  if (facts.length) {
    await tx.candidateFact.updateMany({
      where: { userId, id: { in: factIds } },
      data: { revision: user.candidateRevision },
    });
    await tx.candidateFact.createMany({
      data: facts.map((fact) => ({ ...fact, userId, revision: user.candidateRevision })),
      skipDuplicates: true,
    });
  }
  return user.candidateRevision;
}

export async function rebuildCanonicalCandidateFacts(userId: string): Promise<number> {
  return prisma.$transaction((tx) => refreshCandidateFactsInTransaction(tx, userId));
}
