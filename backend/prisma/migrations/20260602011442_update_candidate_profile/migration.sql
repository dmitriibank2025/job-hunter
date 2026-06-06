/*
  Warnings:

  - You are about to drop the column `name` on the `CandidateProfile` table. All the data in the column will be lost.
  - Added the required column `email` to the `CandidateProfile` table without a default value. This is not possible if the table is not empty.
  - Added the required column `fullName` to the `CandidateProfile` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "CandidateProfile" DROP COLUMN "name",
ADD COLUMN     "email" TEXT NOT NULL,
ADD COLUMN     "fullName" TEXT NOT NULL,
ADD COLUMN     "github" TEXT,
ADD COLUMN     "linkedin" TEXT;
