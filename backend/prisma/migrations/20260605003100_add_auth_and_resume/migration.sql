-- AlterTable
ALTER TABLE "AppUser" ADD COLUMN     "passwordHash" TEXT;

-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN     "resumeFilePath" TEXT;
