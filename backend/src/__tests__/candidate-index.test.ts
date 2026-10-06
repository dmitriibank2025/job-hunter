const indexCandidateRevision = jest.fn();
const candidateIndexJob = {
  updateMany: jest.fn(),
  findUniqueOrThrow: jest.fn(),
  update: jest.fn(),
  findMany: jest.fn(),
};

jest.mock("../infrastructure/prisma", () => ({ prisma: { candidateIndexJob } }));
jest.mock("../services/embedding.service", () => ({ indexCandidateRevision }));

import { processCandidateIndexJob } from "../services/candidate-index.service";

describe("candidate index outbox", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    candidateIndexJob.updateMany.mockResolvedValue({ count: 1 });
    candidateIndexJob.update.mockResolvedValue({});
  });

  it("marks obsolete revisions complete without embedding them", async () => {
    candidateIndexJob.findUniqueOrThrow.mockResolvedValue({
      id: "job-1", userId: "user-1", revision: 4, user: { candidateRevision: 5 },
    });
    await expect(processCandidateIndexJob("job-1")).resolves.toBe("superseded");
    expect(indexCandidateRevision).not.toHaveBeenCalled();
    expect(candidateIndexJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { status: "COMPLETED", lastError: "SUPERSEDED_BY_NEWER_REVISION" },
    });
  });

  it("records a failed embedding job for bounded retry", async () => {
    candidateIndexJob.findUniqueOrThrow.mockResolvedValue({
      id: "job-2", userId: "user-1", revision: 5, user: { candidateRevision: 5 },
    });
    indexCandidateRevision.mockRejectedValue(new Error("embedding unavailable"));
    await expect(processCandidateIndexJob("job-2")).rejects.toThrow("embedding unavailable");
    expect(candidateIndexJob.update).toHaveBeenLastCalledWith({
      where: { id: "job-2" },
      data: { status: "FAILED", lastError: "embedding unavailable" },
    });
  });
});
