ALTER TABLE "AppUser"
    ADD COLUMN IF NOT EXISTS "dailyAutomationFullstackResumeBaseId" TEXT,
    ADD COLUMN IF NOT EXISTS "dailyAutomationBackendResumeBaseId" TEXT,
    ADD COLUMN IF NOT EXISTS "dailyAutomationFrontendResumeBaseId" TEXT;
