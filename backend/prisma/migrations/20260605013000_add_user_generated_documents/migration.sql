ALTER TABLE "ResumeVersion" ADD COLUMN "userId" TEXT;
ALTER TABLE "CoverLetter" ADD COLUMN "userId" TEXT;

CREATE INDEX "ResumeVersion_userId_createdAt_idx" ON "ResumeVersion"("userId", "createdAt");
CREATE INDEX "CoverLetter_userId_createdAt_idx" ON "CoverLetter"("userId", "createdAt");

ALTER TABLE "ResumeVersion"
ADD CONSTRAINT "ResumeVersion_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "AppUser"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CoverLetter"
ADD CONSTRAINT "CoverLetter_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "AppUser"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
