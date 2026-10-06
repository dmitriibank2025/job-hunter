ALTER TABLE "Job"
ADD COLUMN "applyUrl" TEXT,
ADD COLUMN "employmentType" TEXT,
ADD COLUMN "ingestionQualityScore" INTEGER,
ADD COLUMN "ingestionQualityState" TEXT,
ADD COLUMN "ingestionMetadata" JSONB;

CREATE TABLE "AtsSourceConfiguration" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "normalizedCompany" TEXT NOT NULL,
    "careerUrl" TEXT NOT NULL,
    "atsType" TEXT NOT NULL,
    "accountSlug" TEXT,
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastDiscoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastVerifiedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AtsSourceConfiguration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AtsSourceConfiguration_careerUrl_key" ON "AtsSourceConfiguration"("careerUrl");
CREATE INDEX "AtsSourceConfiguration_atsType_active_idx" ON "AtsSourceConfiguration"("atsType", "active");
CREATE INDEX "AtsSourceConfiguration_normalizedCompany_idx" ON "AtsSourceConfiguration"("normalizedCompany");
