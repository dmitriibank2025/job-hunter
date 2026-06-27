ALTER TABLE "AppUser"
    ADD COLUMN IF NOT EXISTS "dailyAutomationEnabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "dailyAutomationTime" TEXT NOT NULL DEFAULT '09:00',
    ADD COLUMN IF NOT EXISTS "dailyAutomationTimezone" TEXT NOT NULL DEFAULT 'Asia/Jerusalem',
    ADD COLUMN IF NOT EXISTS "dailyAutomationLastRunKey" TEXT;

CREATE INDEX IF NOT EXISTS "AppUser_dailyAutomationEnabled_idx"
    ON "AppUser"("dailyAutomationEnabled");
