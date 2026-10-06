/** Versioned pgvector retrieval over canonical, user-owned candidate facts. */
import { createHash } from "crypto";
import OpenAI from "openai";
import type { CandidateFactEntityType, CandidateFactKind } from "@prisma/client";
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

export async function embed(text: string): Promise<number[]> {
    const res = await client().embeddings.create({ model: EMBEDDING_MODEL, input: text });
    return res.data[0].embedding;
}

export async function embedMany(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await client().embeddings.create({ model: EMBEDDING_MODEL, input: texts });
    return res.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
}

function toVectorLiteral(vector: number[]): string {
    return `[${vector.join(",")}]`;
}

function sha256(value: string) {
    return createHash("sha256").update(value).digest("hex");
}

export type CandidateFactChunk = {
    id: string;
    candidateFactId: string | null;
    entityId: string | null;
    entityType: CandidateFactEntityType | null;
    revision: number;
    contentHash: string;
    source: string;
    text: string;
};

type IndexableFact = {
    id: string;
    entityId: string;
    entityType: CandidateFactEntityType;
    kind: CandidateFactKind;
    text: string;
    verified: boolean;
    revision: number;
};

const INDEXABLE_KINDS = new Set<CandidateFactKind>([
    "SUMMARY", "HEADER", "DESCRIPTION", "BULLET", "EDUCATION",
]);

/** Create deterministic chunks that can always be traced to a canonical fact. */
export function buildCandidateFactChunks(facts: IndexableFact[]): CandidateFactChunk[] {
    const headers = new Map(
        facts.filter((fact) => fact.kind === "HEADER")
            .map((fact) => [`${fact.entityType}:${fact.entityId}`, fact.text]),
    );
    return facts
        .filter((fact) => fact.verified && INDEXABLE_KINDS.has(fact.kind) && fact.text.trim())
        .map((fact) => {
            const text = fact.text.trim();
            const contentHash = sha256(text);
            return {
                id: `chunk_${sha256(`${fact.id}\u001f${contentHash}`).slice(0, 32)}`,
                candidateFactId: fact.id,
                entityId: fact.entityId,
                entityType: fact.entityType,
                revision: fact.revision,
                contentHash,
                source: headers.get(`${fact.entityType}:${fact.entityId}`)
                    ?? `${fact.entityType.toLowerCase()}:${fact.entityId}`,
                text,
            };
        });
}

function validateVectors(vectors: number[][], expected: number) {
    if (vectors.length !== expected || vectors.some(
        (vector) => vector.length !== EMBEDDING_DIMS || vector.some((value) => !Number.isFinite(value)),
    )) throw new Error("Invalid embedding response; previous corpus retained");
}

/** Atomically activate one complete candidate revision after every embedding succeeds. */
export async function replaceCandidateFactChunks(
    userId: string,
    revision: number,
    chunks: CandidateFactChunk[],
): Promise<number> {
    if (chunks.some((chunk) => chunk.revision !== revision)) throw new Error("Candidate chunk revision mismatch");
    const vectors = await embedMany(chunks.map((chunk) => chunk.text));
    validateVectors(vectors, chunks.length);
    await prisma.$transaction(async (tx) => {
        const user = await tx.appUser.findUniqueOrThrow({
            where: { id: userId }, select: { candidateRevision: true },
        });
        if (user.candidateRevision !== revision) {
            throw new Error(`Candidate revision changed during indexing (${revision} -> ${user.candidateRevision})`);
        }
        await tx.experienceChunk.updateMany({ where: { userId, active: true }, data: { active: false } });
        for (let index = 0; index < chunks.length; index += 1) {
            const chunk = chunks[index];
            await tx.$executeRawUnsafe(
                `INSERT INTO "ExperienceChunk"
                    ("id","userId","candidateFactId","entityId","entityType","revision","contentHash","active","source","text","embedding","updatedAt")
                 VALUES ($1,$2,$3,$4,$5::"CandidateFactEntityType",$6,$7,true,$8,$9,$10::vector,CURRENT_TIMESTAMP)
                 ON CONFLICT ("id") DO UPDATE SET
                    "candidateFactId"=EXCLUDED."candidateFactId", "entityId"=EXCLUDED."entityId",
                    "entityType"=EXCLUDED."entityType", "revision"=EXCLUDED."revision",
                    "contentHash"=EXCLUDED."contentHash", "active"=true, "source"=EXCLUDED."source",
                    "text"=EXCLUDED."text", "embedding"=EXCLUDED."embedding", "updatedAt"=CURRENT_TIMESTAMP`,
                chunk.id, userId, chunk.candidateFactId, chunk.entityId, chunk.entityType,
                revision, chunk.contentHash, chunk.source, chunk.text, toVectorLiteral(vectors[index]),
            );
        }
    }, { timeout: 30000 });
    return chunks.length;
}

export async function indexCandidateRevision(userId: string, revision: number): Promise<number> {
    const facts = await prisma.candidateFact.findMany({
        where: { userId, revision, verified: true }, orderBy: { id: "asc" },
    });
    return replaceCandidateFactChunks(userId, revision, buildCandidateFactChunks(facts));
}

/** @deprecated Compatibility adapter; canonical candidate-fact indexing is preferred. */
export async function replaceUserChunks(userId: string, chunks: { source: string; text: string }[]): Promise<number> {
    const user = await prisma.appUser.findUniqueOrThrow({
        where: { id: userId }, select: { candidateRevision: true },
    });
    const revision = user.candidateRevision;
    return replaceCandidateFactChunks(userId, revision, chunks.filter((chunk) => chunk.text.trim()).map((chunk, index) => {
        const text = chunk.text.trim();
        const contentHash = sha256(text);
        return {
            id: `chunk_${sha256(`${userId}\u001flegacy\u001f${index}\u001f${contentHash}`).slice(0, 32)}`,
            candidateFactId: null,
            entityId: null,
            entityType: null,
            revision,
            contentHash,
            source: chunk.source,
            text,
        };
    }));
}

export type RetrievedChunk = {
    id: string;
    candidateFactId: string | null;
    entityId: string | null;
    entityType: CandidateFactEntityType | null;
    revision: number;
    source: string;
    text: string;
    distance: number;
};

/** Retrieve only active chunks belonging to the user's current candidate revision. */
export async function retrieveRelevantChunks(userId: string, query: string, k = 6): Promise<RetrievedChunk[]> {
    if (!userId.trim() || !query.trim()) throw new Error("User and search query are required");
    if (!Number.isInteger(k) || k < 1 || k > 10) throw new Error("Retrieval k must be an integer from 1 to 10");
    const vector = await embed(query);
    validateVectors([vector], 1);
    return prisma.$queryRawUnsafe<RetrievedChunk[]>(
        `SELECT c."id", c."candidateFactId", c."entityId", c."entityType", c."revision",
                c."source", c."text", (c."embedding" <=> $1::vector) AS distance
         FROM "ExperienceChunk" c JOIN "AppUser" u ON u."id" = c."userId"
         WHERE c."userId" = $2 AND c."active" = true
           AND c."revision" = u."candidateRevision" AND c."candidateFactId" IS NOT NULL
           AND c."embedding" IS NOT NULL
         ORDER BY distance ASC LIMIT $3`,
        toVectorLiteral(vector), userId, k,
    );
}

export async function countUserChunks(userId: string): Promise<number> {
    const user = await prisma.appUser.findUniqueOrThrow({
        where: { id: userId }, select: { candidateRevision: true },
    });
    return prisma.experienceChunk.count({
        where: { userId, revision: user.candidateRevision, active: true, candidateFactId: { not: null } },
    });
}
