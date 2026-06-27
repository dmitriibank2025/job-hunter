ALTER TABLE "ResumeVersion"
ADD COLUMN "atsScore" INTEGER,
ADD COLUMN "atsIssues" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "atsMatchedKeywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "atsMissingKeywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "atsValidatedAt" TIMESTAMP(3);

CREATE INDEX "ResumeVersion_userId_atsScore_idx" ON "ResumeVersion"("userId", "atsScore");
