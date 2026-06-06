CREATE TYPE "EmailEventType" AS ENUM ('NEW_JOB_ALERT', 'APPLICATION_RECEIVED', 'APPLICATION_VIEWED', 'RECRUITER_MESSAGE', 'ACTION_REQUIRED', 'REJECTION', 'POSITIVE_RESPONSE', 'OTHER');

CREATE TABLE "EmailEvent" (
    "id" TEXT NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "gmailThreadId" TEXT,
    "type" "EmailEventType" NOT NULL DEFAULT 'OTHER',
    "source" TEXT,
    "subject" TEXT NOT NULL,
    "from" TEXT,
    "snippet" TEXT,
    "bodyPreview" TEXT,
    "url" TEXT,
    "emailTs" TIMESTAMP(3) NOT NULL,
    "labels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailEvent_gmailMessageId_key" ON "EmailEvent"("gmailMessageId");
CREATE INDEX "EmailEvent_type_emailTs_idx" ON "EmailEvent"("type", "emailTs");
CREATE INDEX "EmailEvent_emailTs_idx" ON "EmailEvent"("emailTs");
