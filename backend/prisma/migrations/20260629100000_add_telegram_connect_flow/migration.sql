-- UserProfile: connection metadata
ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "telegramUsername" TEXT;
ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "telegramFirstName" TEXT;
ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "telegramConnectedAt" TIMESTAMP(3);

-- Single-use Telegram connect sessions
CREATE TABLE IF NOT EXISTS "TelegramConnectSession" (
    "id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'user_bot',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    CONSTRAINT "TelegramConnectSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TelegramConnectSession_nonce_key" ON "TelegramConnectSession"("nonce");
CREATE INDEX IF NOT EXISTS "TelegramConnectSession_userId_idx" ON "TelegramConnectSession"("userId");
CREATE INDEX IF NOT EXISTS "TelegramConnectSession_expiresAt_idx" ON "TelegramConnectSession"("expiresAt");

DO $$ BEGIN
  ALTER TABLE "TelegramConnectSession" ADD CONSTRAINT "TelegramConnectSession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
