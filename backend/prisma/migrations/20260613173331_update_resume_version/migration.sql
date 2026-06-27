/*
  Warnings:

  - A unique constraint covering the columns `[source,externalJobId]` on the table `Job` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "RejectionReasonType" AS ENUM ('OVERQUALIFIED', 'UNDERQUALIFIED', 'WRONG_TECH_STACK', 'WRONG_SENIORITY', 'LOCATION_MISMATCH', 'COMPANY_TYPE_MISMATCH', 'SALARY_MISMATCH', 'NO_RESPONSE', 'OTHER');

-- CreateEnum
CREATE TYPE "PromptRuleCategory" AS ENUM ('SKILLS', 'SENIORITY', 'COMPANY_TYPE', 'LOCATION', 'GENERAL');

-- DropIndex
DROP INDEX "AppUser_dailyAutomationEnabled_idx";

-- DropIndex
DROP INDEX "ResumeVersion_userId_atsScore_idx";

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "externalJobId" TEXT;

-- AlterTable
ALTER TABLE "UserGmailAccount" ALTER COLUMN "scopes" DROP DEFAULT;

-- CreateTable
CREATE TABLE "RejectionRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "jobTitle" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "matchScore" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "reasonType" "RejectionReasonType" NOT NULL DEFAULT 'OTHER',
    "analysis" JSONB NOT NULL,
    "jobSnippet" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RejectionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "category" "PromptRuleCategory" NOT NULL DEFAULT 'GENERAL',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "appliedCount" INTEGER NOT NULL DEFAULT 0,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RejectionRecord_userId_createdAt_idx" ON "RejectionRecord"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "RejectionRecord_userId_reasonType_idx" ON "RejectionRecord"("userId", "reasonType");

-- CreateIndex
CREATE INDEX "RejectionRecord_jobId_idx" ON "RejectionRecord"("jobId");

-- CreateIndex
CREATE INDEX "PromptRule_userId_confidence_idx" ON "PromptRule"("userId", "confidence" DESC);

-- CreateIndex
CREATE INDEX "PromptRule_userId_category_idx" ON "PromptRule"("userId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "Job_source_externalJobId_key" ON "Job"("source", "externalJobId");

-- AddForeignKey
ALTER TABLE "RejectionRecord" ADD CONSTRAINT "RejectionRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RejectionRecord" ADD CONSTRAINT "RejectionRecord_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptRule" ADD CONSTRAINT "PromptRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
