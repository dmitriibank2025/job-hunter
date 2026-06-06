CREATE TYPE "AppliedVacancyStatus" AS ENUM ('ATTEMPTED', 'APPLIED', 'APPLICATION_RECEIVED', 'APPLICATION_VIEWED', 'RECRUITER_MESSAGE', 'ACTION_REQUIRED', 'REJECTION', 'POSITIVE_RESPONSE');

CREATE TABLE "AppliedVacancy" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "status" "AppliedVacancyStatus" NOT NULL,
    "source" TEXT NOT NULL,
    "jobUrl" TEXT,
    "emailSubject" TEXT,
    "emailFrom" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppliedVacancy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppliedVacancy_fingerprint_key" ON "AppliedVacancy"("fingerprint");
CREATE INDEX "AppliedVacancy_company_title_idx" ON "AppliedVacancy"("company", "title");
CREATE INDEX "AppliedVacancy_status_lastSeenAt_idx" ON "AppliedVacancy"("status", "lastSeenAt");
