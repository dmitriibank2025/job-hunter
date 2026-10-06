jest.mock("../infrastructure/prisma", () => ({
  prisma: {
    job: { findUnique: jest.fn() },
    resumeVersion: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));
jest.mock("../services/user-workspace.service", () => ({
  assertUserLimit: jest.fn(),
  getWorkspaceCandidateProfile: jest.fn(),
  recordUsageEvent: jest.fn(),
}));
jest.mock("../services/resume-base-selector.service", () => ({
  selectResumeBaseForJob: jest.fn(),
}));
jest.mock("../services/resume-pipeline.service", () => ({
  runEvidencePipeline: jest.fn(),
  scoreResumePresentation: jest.fn(() => ({ issues: [] })),
}));
jest.mock("../services/embedding.service", () => ({
  retrieveRelevantChunks: jest.fn(),
}));
jest.mock("../services/docx.service", () => ({
  createStyledResumeDocx: jest.fn(),
  createResumeDocxFromTemplate: jest.fn(),
  convertDocxToPdf: jest.fn(async () => "/tmp/resume.pdf"),
}));
jest.mock("../services/resume-pdf.service", () => ({
  createBasicResumePdf: jest.fn(),
}));
jest.mock("../services/file-storage.service", () => ({
  saveTextFile: jest.fn(),
  ensureDir: jest.fn(),
  getStorageRoot: () => "/tmp",
  slugify: () => "test",
}));
jest.mock("../Logger/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("fs/promises", () => ({
  __esModule: true,
  default: { writeFile: jest.fn() },
}));

import { prisma } from "../infrastructure/prisma";
import { getWorkspaceCandidateProfile } from "../services/user-workspace.service";
import { selectResumeBaseForJob } from "../services/resume-base-selector.service";
import { runEvidencePipeline } from "../services/resume-pipeline.service";
import {
  createStyledResumeDocx,
  convertDocxToPdf,
} from "../services/docx.service";
import { saveTextFile } from "../services/file-storage.service";
import {
  generateResumeForJob,
  regenerateResumeVersion,
} from "../services/resume-generator.service";
import fs from "fs/promises";

describe("production final PASS gate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const job = {
      id: "job",
      title: "Engineer",
      company: "Employer",
      description: "Node.js required. ".repeat(50),
    };
    (prisma.job.findUnique as jest.Mock).mockResolvedValue(job);
    (prisma.resumeVersion.findUnique as jest.Mock).mockResolvedValue({
      id: "resume",
      userId: "user",
      jobId: "job",
      job,
    });
    (getWorkspaceCandidateProfile as jest.Mock).mockResolvedValue({
      fullName: "Dmitrii Bank",
      resume: "source",
      candidateContext: {
        userId: "user",
        revision: 1,
        facts: [],
        profile: { fullName: "Dmitrii Bank" },
        selectedBase: { id: "base", content: "source" },
      },
    });
    (selectResumeBaseForJob as jest.Mock).mockResolvedValue({ id: "base" });
  });
  test.each(["generate", "regenerate"])(
    "%s does not write or render on exhausted FAIL",
    async (mode) => {
      (runEvidencePipeline as jest.Mock).mockRejectedValue(
        new Error("Resume evidence validation FAIL"),
      );
      const action =
        mode === "generate"
          ? generateResumeForJob("job", { userId: "user" })
          : regenerateResumeVersion("resume");
      await expect(action).rejects.toThrow("validation FAIL");
      expect(saveTextFile).not.toHaveBeenCalled();
      expect(fs.writeFile).not.toHaveBeenCalled();
      expect(createStyledResumeDocx).not.toHaveBeenCalled();
      expect(convertDocxToPdf).not.toHaveBeenCalled();
      expect(prisma.resumeVersion.create).not.toHaveBeenCalled();
      expect(prisma.resumeVersion.update).not.toHaveBeenCalled();
    },
  );
  test("PASS saves provenance then renders exact content without another rewrite", async () => {
    const content = "Final validated resume";
    (runEvidencePipeline as jest.Mock).mockResolvedValue({
      content,
      validation: {
        valid: true,
        score: { total: 63 },
        missingRequirements: [],
      },
      analysis: { requirements: [] },
      attempts: [],
    });
    (prisma.resumeVersion.create as jest.Mock).mockImplementation(
      async ({ data }) => ({ id: "saved", ...data }),
    );
    const result = await generateResumeForJob("job", { userId: "user" });
    expect(result.atsScore).toBe(63);
    expect(createStyledResumeDocx).toHaveBeenCalledWith(
      content,
      expect.any(String),
    );
    expect(saveTextFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringMatching(/\.evidence\.json$/),
      expect.stringContaining('"valid": true'),
    );
    expect(convertDocxToPdf).toHaveBeenCalledTimes(1);
  });
});
