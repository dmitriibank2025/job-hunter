-- Per-user "exclude remote vacancies" toggle for daily + manual search.
ALTER TABLE "AppUser" ADD COLUMN IF NOT EXISTS "searchExcludeRemote" BOOLEAN NOT NULL DEFAULT false;

-- Per-user company blacklist.
CREATE TABLE IF NOT EXISTS "UserBlacklistedCompany" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBlacklistedCompany_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserBlacklistedCompany_userId_normalizedName_key"
    ON "UserBlacklistedCompany"("userId", "normalizedName");

CREATE INDEX IF NOT EXISTS "UserBlacklistedCompany_userId_idx"
    ON "UserBlacklistedCompany"("userId");

ALTER TABLE "UserBlacklistedCompany"
    ADD CONSTRAINT "UserBlacklistedCompany_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
