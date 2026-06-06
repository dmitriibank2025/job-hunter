CREATE TABLE "CompanyPriorityTarget" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "locationHint" TEXT,
    "careerUrl" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 50,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "sourceHits" INTEGER NOT NULL DEFAULT 0,
    "centerHits" INTEGER NOT NULL DEFAULT 0,
    "totalJobsFound" INTEGER NOT NULL DEFAULT 0,
    "checksCount" INTEGER NOT NULL DEFAULT 0,
    "consecutiveNoJobs" INTEGER NOT NULL DEFAULT 0,
    "lastFoundAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "nextCheckAt" TIMESTAMP(3),
    "lastSource" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyPriorityTarget_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyPriorityTarget_name_key" ON "CompanyPriorityTarget"("name");
CREATE UNIQUE INDEX "CompanyPriorityTarget_normalizedName_key" ON "CompanyPriorityTarget"("normalizedName");
CREATE INDEX "CompanyPriorityTarget_active_priority_idx" ON "CompanyPriorityTarget"("active", "priority");
CREATE INDEX "CompanyPriorityTarget_nextCheckAt_idx" ON "CompanyPriorityTarget"("nextCheckAt");
CREATE INDEX "CompanyPriorityTarget_lastFoundAt_idx" ON "CompanyPriorityTarget"("lastFoundAt");
