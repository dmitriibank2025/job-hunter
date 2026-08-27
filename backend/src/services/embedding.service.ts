/**
 * Embeddings + vector retrieval (RAG) over the candidate's experience corpus.
 *
 * Uses OpenAI text-embedding-3-small (1536 dims) stored in the pgvector
 * `ExperienceChunk.embedding` column. Retrieval is cosine distance (`<=>`) via
 * raw SQL, since Prisma types the vector column as Unsupported.
 *
 * Powers two things:
 *   - RAG grounding: retrieve the top-k most relevant experience for a vacancy
 *     and inject it into the generation prompt.
 *   - The agent's `search_experience` tool (function calling).
 */
import OpenAI from "openai";
import { randomUUID } from "crypto";
import { prisma } from "../infrastructure/prisma";

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
export const EMBEDDING_DIMS = 1536;

let _client: OpenAI | null = null;
function client(): OpenAI {
    if (_client) return _client;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
    _client = new OpenAI({ apiKey });
    return _client;
}

/** Embed a single text into a 1536-dim vector. */
export async function embed(text: string): Promise<number[]> {
    const res = await client().embeddings.create({ model: EMBEDDING_MODEL, input: text });
    return res.data[0].embedding;
}

/** Embed many texts in one request (order preserved). */
export async function embedMany(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await client().embeddings.create({ model: EMBEDDING_MODEL, input: texts });
    return res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

function toVectorLiteral(v: number[]): string {
    return `[${v.join(",")}]`;
}

/** Replace the whole experience corpus for a user with freshly-embedded chunks. */
export async function replaceUserChunks(
    userId: string,
    chunks: { source: string; text: string }[],
): Promise<number> {
    const unique = chunks.filter((c) => c.text.trim().length > 0);
    const vectors = await embedMany(unique.map((c) => c.text));

    await prisma.experienceChunk.deleteMany({ where: { userId } });
    for (let i = 0; i < unique.length; i += 1) {
        await prisma.$executeRawUnsafe(
            `INSERT INTO "ExperienceChunk" ("id","userId","source","text","embedding")
             VALUES ($1,$2,$3,$4,$5::vector)`,
            randomUUID(),
            userId,
            unique[i].source,
            unique[i].text,
            toVectorLiteral(vectors[i]),
        );
    }
    return unique.length;
}

export type RetrievedChunk = { source: string; text: string; distance: number };

/** Retrieve the top-k experience chunks most relevant to `query` (cosine distance). */
export async function retrieveRelevantChunks(
    userId: string,
    query: string,
    k = 6,
): Promise<RetrievedChunk[]> {
    const q = await embed(query);
    return prisma.$queryRawUnsafe<RetrievedChunk[]>(
        `SELECT "source", "text", ("embedding" <=> $1::vector) AS distance
         FROM "ExperienceChunk"
         WHERE "userId" = $2 AND "embedding" IS NOT NULL
         ORDER BY distance ASC
         LIMIT $3`,
        toVectorLiteral(q),
        userId,
        k,
    );
}

export async function countUserChunks(userId: string): Promise<number> {
    return prisma.experienceChunk.count({ where: { userId } });
}
