import {
  buildResumeBaseDefinition,
  resolveResumeBaseUpdate,
} from "../services/resume-base-lifecycle.service";

const existing = {
  mode: "LINKED" as const,
  renderStatus: "CURRENT" as const,
  sourceRevision: 7,
  content: "Existing generated content",
  target: "BACKEND" as const,
  targetTitle: "Backend Engineer",
  definition: buildResumeBaseDefinition({
    target: "BACKEND",
    targetTitle: "Backend Engineer",
    template: "ATS",
  }),
};

describe("resume base lifecycle", () => {
  it("detaches a linked base when its rendered content is manually edited", () => {
    expect(resolveResumeBaseUpdate({ existing, patch: { content: "Manually edited content" }, currentCandidateRevision: 7 })).toMatchObject({
      mode: "DETACHED",
      sourceRevision: null,
      renderStatus: "PROCESSING",
      shouldRender: true,
    });
  });

  it("marks linked bases stale when their definition changes", () => {
    expect(resolveResumeBaseUpdate({ existing, patch: { targetTitle: "Platform Engineer" }, currentCandidateRevision: 7 })).toMatchObject({
      mode: "LINKED",
      sourceRevision: 7,
      renderStatus: "STALE",
      shouldRender: false,
    });
  });

  it("keeps snapshot metadata current when only its name changes", () => {
    expect(resolveResumeBaseUpdate({
      existing: { ...existing, mode: "UPLOADED_SNAPSHOT", sourceRevision: null },
      patch: {},
      currentCandidateRevision: 7,
    })).toMatchObject({
      mode: "UPLOADED_SNAPSHOT",
      sourceRevision: null,
      renderStatus: "CURRENT",
      shouldRender: false,
    });
  });

  it("does not hide a stale linked source after re-rendering its template", () => {
    expect(resolveResumeBaseUpdate({
      existing: { ...existing, sourceRevision: 6, renderStatus: "STALE" },
      patch: { template: "MODERN" },
      currentCandidateRevision: 7,
    })).toMatchObject({
      renderStatus: "PROCESSING",
      statusAfterRender: "STALE",
      shouldRender: true,
    });
  });
});
