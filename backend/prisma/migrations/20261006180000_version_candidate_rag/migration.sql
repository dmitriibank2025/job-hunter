CREATE TYPE "CandidateIndexJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

ALTER TABLE "ExperienceChunk"
    ADD COLUMN "candidateFactId" TEXT,
    ADD COLUMN "entityId" TEXT,
    ADD COLUMN "entityType" "CandidateFactEntityType",
    ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "contentHash" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "CandidateIndexJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" "CandidateIndexJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CandidateIndexJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExperienceChunk_userId_revision_active_idx"
    ON "ExperienceChunk"("userId", "revision", "active");
CREATE INDEX "ExperienceChunk_candidateFactId_idx"
    ON "ExperienceChunk"("candidateFactId");
CREATE UNIQUE INDEX "CandidateIndexJob_userId_revision_key"
    ON "CandidateIndexJob"("userId", "revision");
CREATE INDEX "CandidateIndexJob_status_updatedAt_idx"
    ON "CandidateIndexJob"("status", "updatedAt");

ALTER TABLE "ExperienceChunk"
    ADD CONSTRAINT "ExperienceChunk_candidateFactId_fkey"
    FOREIGN KEY ("candidateFactId") REFERENCES "CandidateFact"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CandidateIndexJob"
    ADD CONSTRAINT "CandidateIndexJob_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "AppUser"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Legacy resume-file chunks cannot prove which canonical revision produced them.
-- Keep them for auditability but exclude them from current-revision retrieval.
UPDATE "ExperienceChunk" SET "active" = false, "revision" = 0;
