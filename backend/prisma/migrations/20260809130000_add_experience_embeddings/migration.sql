-- pgvector extension (image swapped to pgvector/pgvector:pg16)
CREATE EXTENSION IF NOT EXISTS vector;

-- Candidate experience corpus for RAG grounding + agent search_experience tool
CREATE TABLE "ExperienceChunk" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExperienceChunk_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExperienceChunk_userId_idx" ON "ExperienceChunk"("userId");

-- Approximate-nearest-neighbour index for cosine distance retrieval
CREATE INDEX "ExperienceChunk_embedding_idx"
    ON "ExperienceChunk" USING hnsw ("embedding" vector_cosine_ops);

ALTER TABLE "ExperienceChunk"
    ADD CONSTRAINT "ExperienceChunk_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
