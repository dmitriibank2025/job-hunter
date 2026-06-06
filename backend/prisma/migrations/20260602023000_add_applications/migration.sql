-- Track automated application submission attempts and their generated package.
CREATE TYPE "ApplicationStatus" AS ENUM ('READY', 'SUBMITTING', 'SUBMITTED', 'FAILED', 'NEEDS_REVIEW');

CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "resumeVersionId" TEXT NOT NULL,
    "coverLetterId" TEXT,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'READY',
    "submitUrl" TEXT,
    "autoSubmit" BOOLEAN NOT NULL DEFAULT false,
    "formSnapshot" JSONB,
    "error" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Application" ADD CONSTRAINT "Application_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Application" ADD CONSTRAINT "Application_resumeVersionId_fkey" FOREIGN KEY ("resumeVersionId") REFERENCES "ResumeVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Application" ADD CONSTRAINT "Application_coverLetterId_fkey" FOREIGN KEY ("coverLetterId") REFERENCES "CoverLetter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
