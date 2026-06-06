-- Add stable deduplication keys for collected and manually-created jobs.
ALTER TABLE "Job" ADD COLUMN "normalizedUrl" TEXT;
ALTER TABLE "Job" ADD COLUMN "fingerprint" TEXT;

CREATE UNIQUE INDEX "Job_normalizedUrl_key" ON "Job"("normalizedUrl");
CREATE UNIQUE INDEX "Job_fingerprint_key" ON "Job"("fingerprint");
