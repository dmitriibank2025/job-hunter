CREATE TABLE IF NOT EXISTS "UserGmailAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT,
    "googleUserId" TEXT NOT NULL DEFAULT 'me',
    "refreshToken" TEXT NOT NULL,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "UserGmailAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserGmailAccount_userId_key"
    ON "UserGmailAccount"("userId");

CREATE INDEX IF NOT EXISTS "UserGmailAccount_isActive_idx"
    ON "UserGmailAccount"("isActive");

ALTER TABLE "UserGmailAccount"
    ADD CONSTRAINT "UserGmailAccount_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "AppUser"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
