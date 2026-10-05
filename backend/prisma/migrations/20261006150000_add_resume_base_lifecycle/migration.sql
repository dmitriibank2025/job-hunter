-- Existing bases are preserved as immutable snapshots. New structured bases
-- are created as LINKED by the application after this migration.
CREATE TYPE "ResumeBaseMode" AS ENUM ('LINKED', 'UPLOADED_SNAPSHOT', 'DETACHED');
CREATE TYPE "ResumeBaseStatus" AS ENUM ('CURRENT', 'STALE', 'PROCESSING', 'FAILED');

ALTER TABLE "UserResumeBase"
    ADD COLUMN "mode" "ResumeBaseMode" NOT NULL DEFAULT 'UPLOADED_SNAPSHOT',
    ADD COLUMN "sourceRevision" INTEGER,
    ADD COLUMN "definition" JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN "renderStatus" "ResumeBaseStatus" NOT NULL DEFAULT 'CURRENT';

-- Prisma's runtime default is LINKED for newly generated structured bases;
-- retain the safe snapshot classification for every pre-migration row.
ALTER TABLE "UserResumeBase" ALTER COLUMN "mode" SET DEFAULT 'LINKED';

CREATE INDEX "UserResumeBase_userId_mode_renderStatus_idx"
    ON "UserResumeBase"("userId", "mode", "renderStatus");
