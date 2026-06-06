-- Backfill owner for legacy single-user records before enforcing user boundaries.
INSERT INTO "AppUser" ("id", "email", "role", "plan", "status", "createdAt", "updatedAt")
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'system@job-hunter.local',
    'ADMIN',
    'PRO',
    'ACTIVE',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("email") DO NOTHING;

-- User-specific job state belongs in UserJobMatch, not in global Job rows.
CREATE TYPE "UserJobStatus" AS ENUM ('NEW', 'ANALYZED', 'SAVED', 'REJECTED', 'APPLIED', 'IGNORED');

ALTER TABLE "UserJobMatch" ADD COLUMN "status" "UserJobStatus" NOT NULL DEFAULT 'NEW';

UPDATE "UserJobMatch"
SET "status" = CASE
    WHEN "ignoredAt" IS NOT NULL THEN 'IGNORED'::"UserJobStatus"
    WHEN "appliedAt" IS NOT NULL THEN 'APPLIED'::"UserJobStatus"
    WHEN "matchScore" IS NOT NULL OR "analysis" IS NOT NULL THEN 'ANALYZED'::"UserJobStatus"
    ELSE 'NEW'::"UserJobStatus"
END;

CREATE INDEX "UserJobMatch_userId_status_updatedAt_idx" ON "UserJobMatch"("userId", "status", "updatedAt");

-- Remove legacy global analysis fields from Job.
ALTER TABLE "Job" DROP COLUMN IF EXISTS "matchScore";
ALTER TABLE "Job" DROP COLUMN IF EXISTS "analysis";

-- Generated documents must have an owner.
UPDATE "ResumeVersion"
SET "userId" = '00000000-0000-0000-0000-000000000001'
WHERE "userId" IS NULL;

UPDATE "CoverLetter"
SET "userId" = '00000000-0000-0000-0000-000000000001'
WHERE "userId" IS NULL;

ALTER TABLE "ResumeVersion" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "CoverLetter" ALTER COLUMN "userId" SET NOT NULL;

ALTER TABLE "ResumeVersion" DROP CONSTRAINT IF EXISTS "ResumeVersion_userId_fkey";
ALTER TABLE "CoverLetter" DROP CONSTRAINT IF EXISTS "CoverLetter_userId_fkey";

ALTER TABLE "ResumeVersion"
ADD CONSTRAINT "ResumeVersion_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CoverLetter"
ADD CONSTRAINT "CoverLetter_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Applications are user-owned even if they also reference user-owned documents.
ALTER TABLE "Application" ADD COLUMN "userId" TEXT;

UPDATE "Application" AS a
SET "userId" = COALESCE(
    (SELECT rv."userId" FROM "ResumeVersion" AS rv WHERE rv."id" = a."resumeVersionId"),
    (SELECT cl."userId" FROM "CoverLetter" AS cl WHERE cl."id" = a."coverLetterId"),
    '00000000-0000-0000-0000-000000000001'
);

UPDATE "Application"
SET "userId" = '00000000-0000-0000-0000-000000000001'
WHERE "userId" IS NULL;

ALTER TABLE "Application" ALTER COLUMN "userId" SET NOT NULL;

ALTER TABLE "Application"
ADD CONSTRAINT "Application_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Application_userId_status_createdAt_idx" ON "Application"("userId", "status", "createdAt");
CREATE INDEX "Application_userId_jobId_idx" ON "Application"("userId", "jobId");

-- Email events are per Gmail/user account. Legacy env-based imports belong to the system user.
ALTER TABLE "EmailEvent" ADD COLUMN "userId" TEXT;

UPDATE "EmailEvent"
SET "userId" = '00000000-0000-0000-0000-000000000001'
WHERE "userId" IS NULL;

ALTER TABLE "EmailEvent" ALTER COLUMN "userId" SET NOT NULL;

DROP INDEX IF EXISTS "EmailEvent_gmailMessageId_key";
DROP INDEX IF EXISTS "EmailEvent_type_emailTs_idx";
DROP INDEX IF EXISTS "EmailEvent_emailTs_idx";

ALTER TABLE "EmailEvent"
ADD CONSTRAINT "EmailEvent_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "EmailEvent_userId_gmailMessageId_key" ON "EmailEvent"("userId", "gmailMessageId");
CREATE INDEX "EmailEvent_userId_type_emailTs_idx" ON "EmailEvent"("userId", "type", "emailTs");
CREATE INDEX "EmailEvent_userId_emailTs_idx" ON "EmailEvent"("userId", "emailTs");

-- Applied history is per user. The same job can be applied by many users.
ALTER TABLE "AppliedVacancy" ADD COLUMN "userId" TEXT;

UPDATE "AppliedVacancy"
SET "userId" = '00000000-0000-0000-0000-000000000001'
WHERE "userId" IS NULL;

ALTER TABLE "AppliedVacancy" ALTER COLUMN "userId" SET NOT NULL;

DROP INDEX IF EXISTS "AppliedVacancy_fingerprint_key";
DROP INDEX IF EXISTS "AppliedVacancy_company_title_idx";
DROP INDEX IF EXISTS "AppliedVacancy_status_lastSeenAt_idx";

ALTER TABLE "AppliedVacancy"
ADD CONSTRAINT "AppliedVacancy_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "AppliedVacancy_userId_fingerprint_key" ON "AppliedVacancy"("userId", "fingerprint");
CREATE INDEX "AppliedVacancy_userId_company_title_idx" ON "AppliedVacancy"("userId", "company", "title");
CREATE INDEX "AppliedVacancy_userId_status_lastSeenAt_idx" ON "AppliedVacancy"("userId", "status", "lastSeenAt");
