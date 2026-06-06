-- Store source publication time so duplicate detection can use company + title + postedAt.
ALTER TABLE "Job" ADD COLUMN "postedAt" TIMESTAMP(3);

-- Existing fingerprints were based on title + company + location. Reset them so the
-- column consistently represents the new title + company + postedAt key.
UPDATE "Job" SET "fingerprint" = NULL;
