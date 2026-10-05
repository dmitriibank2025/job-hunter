import type { ResumeBaseMode, ResumeBaseStatus, ResumeBaseTarget } from "@prisma/client";

export type ResumeBaseTemplate = "ATS" | "MODERN" | "COMPACT";

export type ResumeBaseDefinitionV1 = {
  version: 1;
  target: ResumeBaseTarget;
  targetTitle: string | null;
  template: ResumeBaseTemplate;
};

export function buildResumeBaseDefinition(input: {
  target: ResumeBaseTarget;
  targetTitle?: string | null;
  template?: ResumeBaseTemplate;
}): ResumeBaseDefinitionV1 {
  return {
    version: 1,
    target: input.target,
    targetTitle: input.targetTitle?.trim() || null,
    template: input.template ?? "ATS",
  };
}

export function readResumeBaseDefinition(
  value: unknown,
  fallback: { target: ResumeBaseTarget; targetTitle?: string | null },
): ResumeBaseDefinitionV1 {
  if (value && typeof value === "object") {
    const candidate = value as Partial<ResumeBaseDefinitionV1>;
    if (
      candidate.version === 1 &&
      typeof candidate.target === "string" &&
      ["FRONTEND", "BACKEND", "FULLSTACK", "CUSTOM"].includes(candidate.target) &&
      typeof candidate.template === "string" &&
      ["ATS", "MODERN", "COMPACT"].includes(candidate.template)
    ) {
      return {
        version: 1,
        target: candidate.target,
        targetTitle: typeof candidate.targetTitle === "string" ? candidate.targetTitle : null,
        template: candidate.template as ResumeBaseTemplate,
      };
    }
  }
  return buildResumeBaseDefinition(fallback);
}

export function resolveResumeBaseUpdate(input: {
  existing: {
    mode: ResumeBaseMode;
    renderStatus: ResumeBaseStatus;
    sourceRevision: number | null;
    content: string;
    target: ResumeBaseTarget;
    targetTitle: string | null;
    definition: unknown;
  };
  patch: {
    content?: string;
    target?: ResumeBaseTarget;
    targetTitle?: string | null;
    template?: ResumeBaseTemplate;
  };
  currentCandidateRevision: number;
}) {
  const currentDefinition = readResumeBaseDefinition(input.existing.definition, input.existing);
  const nextDefinition = buildResumeBaseDefinition({
    target: input.patch.target ?? input.existing.target,
    targetTitle: input.patch.targetTitle === undefined ? input.existing.targetTitle : input.patch.targetTitle,
    template: input.patch.template ?? currentDefinition.template,
  });
  const contentChanged = input.patch.content !== undefined && input.patch.content !== input.existing.content;
  const contentDefinitionChanged =
    currentDefinition.target !== nextDefinition.target ||
    currentDefinition.targetTitle !== nextDefinition.targetTitle;
  const shouldRender = contentChanged || input.patch.template !== undefined;
  const mode: ResumeBaseMode = contentChanged ? "DETACHED" : input.existing.mode;
  const linkedSourceIsStale = mode === "LINKED" && (
    input.existing.sourceRevision == null ||
    input.existing.sourceRevision < input.currentCandidateRevision ||
    contentDefinitionChanged
  );
  const renderStatus: ResumeBaseStatus = shouldRender
    ? "PROCESSING"
    : linkedSourceIsStale
      ? "STALE"
      : input.existing.renderStatus;

  return {
    mode,
    sourceRevision: mode === "DETACHED" ? null : input.existing.sourceRevision,
    definition: nextDefinition,
    renderStatus,
    shouldRender,
    statusAfterRender: linkedSourceIsStale ? "STALE" as const : "CURRENT" as const,
  };
}
