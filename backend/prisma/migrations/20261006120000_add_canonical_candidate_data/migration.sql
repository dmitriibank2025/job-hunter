-- Stage 1 of the multi-user candidate-data migration.
-- Existing resume bases remain unchanged; the new canonical facts are populated
-- on the next structured profile save or by the backfill script.
CREATE TYPE "CandidateExperienceType" AS ENUM ('COMMERCIAL', 'FREELANCE', 'INTERNSHIP', 'VOLUNTEER');
CREATE TYPE "CandidateProjectType" AS ENUM ('PERSONAL', 'EDUCATIONAL', 'OPEN_SOURCE');
CREATE TYPE "CandidateFactEntityType" AS ENUM ('PROFILE', 'TECHNOLOGY', 'EXPERIENCE', 'PROJECT', 'EDUCATION');
CREATE TYPE "CandidateFactKind" AS ENUM ('CONTACT', 'SUMMARY', 'HEADER', 'DESCRIPTION', 'BULLET', 'TECHNOLOGY', 'EDUCATION');

ALTER TABLE "AppUser" ADD COLUMN "candidateRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UserExperience" ADD COLUMN "type" "CandidateExperienceType" NOT NULL DEFAULT 'COMMERCIAL';

CREATE TABLE "UserProject" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "CandidateProjectType" NOT NULL DEFAULT 'PERSONAL',
    "name" TEXT NOT NULL,
    "role" TEXT,
    "url" TEXT,
    "startDate" TEXT,
    "endDate" TEXT,
    "description" TEXT,
    "bullets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "technologies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserProject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CandidateFact" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityType" "CandidateFactEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "kind" "CandidateFactKind" NOT NULL,
    "text" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CandidateFact_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UserProject_userId_sortOrder_idx" ON "UserProject"("userId", "sortOrder");
CREATE UNIQUE INDEX "CandidateFact_userId_fingerprint_key" ON "CandidateFact"("userId", "fingerprint");
CREATE INDEX "CandidateFact_userId_revision_idx" ON "CandidateFact"("userId", "revision");
CREATE INDEX "CandidateFact_userId_entityType_entityId_idx" ON "CandidateFact"("userId", "entityType", "entityId");

ALTER TABLE "UserProject" ADD CONSTRAINT "UserProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CandidateFact" ADD CONSTRAINT "CandidateFact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
