-- Preserve user matches and analysis, but quarantine old category pages that
-- were previously ingested as vacancies. These URL shapes are discovery pages.
UPDATE "Job"
SET "company" = NULL,
    "ingestionQualityScore" = 0,
    "ingestionQualityState" = 'REJECTED',
    "ingestionMetadata" = jsonb_build_object(
        'classification', 'category',
        'classificationReasons', jsonb_build_array('LEGACY_CATEGORY_URL'),
        'qualityScore', 0,
        'qualityState', 'REJECTED',
        'sourceDetail', jsonb_build_object('audit', '2026-10-05 legacy database audit')
    ),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE ("source" = 'NISHA' AND "url" ~* '^https?://(www\.)?nisha\.co\.il/positions/')
   OR ("source" = 'EMPLOYBL' AND "url" ~* '^https?://(www\.)?employbl\.com/jobs/titles/?$');
