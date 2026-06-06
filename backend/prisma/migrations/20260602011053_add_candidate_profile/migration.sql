/*
  Warnings:

  - Added the required column `name` to the `CandidateProfile` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `CandidateProfile` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "CandidateProfile" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "name" TEXT NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;
