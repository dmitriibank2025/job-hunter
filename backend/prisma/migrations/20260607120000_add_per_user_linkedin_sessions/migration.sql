-- Convert legacy LinkedIn account references into per-user browser storage-state sessions.
ALTER TABLE "UserLinkedInAccount"
    DROP COLUMN IF EXISTS "passwordSecretRef",
    DROP COLUMN IF EXISTS "note",
    ADD COLUMN IF NOT EXISTS "profileUrl" TEXT,
    ADD COLUMN IF NOT EXISTS "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS "lastUsedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;

UPDATE "UserLinkedInAccount"
SET "storageStatePath" = CONCAT('storage/linkedin/', "userId", '.json')
WHERE "storageStatePath" IS NULL OR trim("storageStatePath") = '';

ALTER TABLE "UserLinkedInAccount"
    ALTER COLUMN "email" DROP NOT NULL,
    ALTER COLUMN "storageStatePath" SET NOT NULL;

DROP INDEX IF EXISTS "UserLinkedInAccount_userId_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "UserLinkedInAccount_userId_key"
    ON "UserLinkedInAccount"("userId");

CREATE INDEX IF NOT EXISTS "UserLinkedInAccount_isActive_idx"
    ON "UserLinkedInAccount"("isActive");
