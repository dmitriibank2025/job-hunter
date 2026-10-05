const createEmbedding = jest.fn();
jest.mock("openai", () => ({ __esModule: true, default: jest.fn(() => ({ embeddings: { create: createEmbedding } })) }));
jest.mock("../infrastructure/prisma", () => ({ prisma: { $transaction: jest.fn() } }));
import { prisma } from "../infrastructure/prisma";
import { replaceUserChunks, EMBEDDING_DIMS } from "../services/embedding.service";

describe("atomic experience corpus replacement", () => {
  beforeEach(() => { jest.clearAllMocks(); process.env.OPENAI_API_KEY = "test-only"; });
  test("invalid embeddings never enter the destructive transaction", async () => {
    createEmbedding.mockResolvedValue({ data: [{ index: 0, embedding: [1] }] });
    await expect(replaceUserChunks("user", [{ source: "source", text: "fact" }])).rejects.toThrow("previous corpus retained");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  test("deletion and insertion use the same transaction", async () => {
    createEmbedding.mockResolvedValue({ data: [{ index: 0, embedding: Array(EMBEDDING_DIMS).fill(0.01) }] });
    const tx = { experienceChunk: { deleteMany: jest.fn() }, $executeRawUnsafe: jest.fn() };
    (prisma.$transaction as jest.Mock).mockImplementation(fn => fn(tx));
    await expect(replaceUserChunks("user", [{ source: "source", text: "fact" }])).resolves.toBe(1);
    expect(tx.experienceChunk.deleteMany).toHaveBeenCalledWith({ where: { userId: "user" } });
    expect(tx.$executeRawUnsafe).toHaveBeenCalledTimes(1);
  });
});
