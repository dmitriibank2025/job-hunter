-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('NEW', 'ANALYZED', 'SAVED', 'REJECTED', 'APPLIED');

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT,
    "location" TEXT,
    "url" TEXT,
    "description" TEXT NOT NULL,
    "source" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'NEW',
    "matchScore" INTEGER,
    "analysis" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);
