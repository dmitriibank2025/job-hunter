-- CreateTable
CREATE TABLE "AuthRefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthRefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserJobMatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "matchScore" INTEGER,
    "analysis" JSONB,
    "matchedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "ignoredAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserJobMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthRefreshToken_tokenHash_key" ON "AuthRefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthRefreshToken_userId_expiresAt_idx" ON "AuthRefreshToken"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserJobMatch_userId_jobId_key" ON "UserJobMatch"("userId", "jobId");

-- CreateIndex
CREATE INDEX "UserJobMatch_userId_matchScore_idx" ON "UserJobMatch"("userId", "matchScore");

-- CreateIndex
CREATE INDEX "UserJobMatch_userId_appliedAt_idx" ON "UserJobMatch"("userId", "appliedAt");

-- AddForeignKey
ALTER TABLE "AuthRefreshToken" ADD CONSTRAINT "AuthRefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserJobMatch" ADD CONSTRAINT "UserJobMatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserJobMatch" ADD CONSTRAINT "UserJobMatch_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
