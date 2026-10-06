const createEmbedding = jest.fn();
jest.mock("openai", () => ({ __esModule: true, default: jest.fn(() => ({ embeddings: { create: createEmbedding } })) }));
jest.mock("../infrastructure/prisma", () => ({
  prisma: { $transaction: jest.fn(), $queryRawUnsafe: jest.fn() },
}));

import { prisma } from "../infrastructure/prisma";
import {
  buildCandidateFactChunks,
  EMBEDDING_DIMS,
  replaceCandidateFactChunks,
  retrieveRelevantChunks,
} from "../services/embedding.service";

const facts = [
  { id: "header", entityId: "exp-1", entityType: "EXPERIENCE" as const, kind: "HEADER" as const, text: "2024 – Present | Engineer | Example", verified: true, revision: 7 },
  { id: "bullet", entityId: "exp-1", entityType: "EXPERIENCE" as const, kind: "BULLET" as const, text: "Built reliable APIs.", verified: true, revision: 7 },
  { id: "technology", entityId: "typescript", entityType: "TECHNOLOGY" as const, kind: "TECHNOLOGY" as const, text: "TypeScript", verified: true, revision: 7 },
  { id: "contact", entityId: "profile", entityType: "PROFILE" as const, kind: "CONTACT" as const, text: "private@example.test", verified: true, revision: 7 },
];

describe("versioned candidate fact embeddings", () => {
  beforeEach(() => { jest.clearAllMocks(); process.env.OPENAI_API_KEY = "test-only"; });

  test("builds deterministic, traceable chunks and excludes contact data", () => {
    const chunks = buildCandidateFactChunks(facts);
    expect(chunks).toHaveLength(2);
    expect(chunks[1]).toMatchObject({
      candidateFactId: "bullet",
      entityId: "exp-1",
      revision: 7,
      source: "2024 – Present | Engineer | Example",
    });
    expect(buildCandidateFactChunks([...facts].reverse()).map((item) => item.id).sort())
      .toEqual(chunks.map((item) => item.id).sort());
  });

  test("invalid embeddings never enter the replacement transaction", async () => {
    createEmbedding.mockResolvedValue({ data: [{ index: 0, embedding: [1] }, { index: 1, embedding: [1] }] });
    await expect(replaceCandidateFactChunks("user", 7, buildCandidateFactChunks(facts)))
      .rejects.toThrow("previous corpus retained");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test("activation is atomic and guarded by the current revision", async () => {
    createEmbedding.mockResolvedValue({ data: [
      { index: 0, embedding: Array(EMBEDDING_DIMS).fill(0.01) },
      { index: 1, embedding: Array(EMBEDDING_DIMS).fill(0.02) },
    ] });
    const tx = {
      appUser: { findUniqueOrThrow: jest.fn().mockResolvedValue({ candidateRevision: 7 }) },
      experienceChunk: { updateMany: jest.fn() },
      $executeRawUnsafe: jest.fn(),
    };
    (prisma.$transaction as jest.Mock).mockImplementation((fn) => fn(tx));
    await expect(replaceCandidateFactChunks("user", 7, buildCandidateFactChunks(facts))).resolves.toBe(2);
    expect(tx.experienceChunk.updateMany).toHaveBeenCalledWith({
      where: { userId: "user", active: true }, data: { active: false },
    });
    expect(tx.$executeRawUnsafe).toHaveBeenCalledTimes(2);
  });

  test("retrieval SQL requires active chunks from the current user revision", async () => {
    createEmbedding.mockResolvedValue({ data: [{ index: 0, embedding: Array(EMBEDDING_DIMS).fill(0.01) }] });
    (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValue([]);
    await retrieveRelevantChunks("user", "Node.js", 3);
    const sql = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0][0] as string;
    expect(sql).toContain('c."active" = true');
    expect(sql).toContain('c."revision" = u."candidateRevision"');
    expect(sql).toContain('c."candidateFactId" IS NOT NULL');
  });
});
