# Job ingestion architecture

## Assessment

The previous collectors mixed discovery links, list-card text, and real vacancy pages. This produced three recurring failures:

1. category and navigation pages could be interpreted as vacancies;
2. board names or generic labels could leak into `company`/`title`;
3. missing `location` or `postedAt` looked like a successful filter match instead of an unverifiable field.

The production flow is now:

`source discovery -> page classification -> detail retrieval -> structured extraction -> source DOM fallback -> normalization -> quality/geography/relevance -> deduplication -> persistence`

LLM extraction is intentionally not the default. Official ATS APIs and `JobPosting` JSON-LD have higher authority. A future LLM fallback must emit the same field-level confidence and source evidence and must never replace a known value with a guess.

## Shared contract

Every normalized vacancy has the stable core fields `title`, optional `company`, optional `location`, `description`, canonical `url`, optional `applyUrl`, optional `postedAt`, optional `employmentType`, `source`, and `externalJobId`.

Ingestion metadata records:

- page classification and reasons;
- extraction method;
- per-field confidence;
- quality score/state;
- Israel/remote eligibility and reason;
- detected technologies;
- canonical URL and source-specific date semantics.

Missing optional fields are retained as unknown. They reduce confidence but do not become invented values and do not automatically discard an otherwise real vacancy.

## Page classification

Pages are classified as `job_detail`, `category`, `search_results`, `company_page`, `apply_page`, `pagination`, or `unknown`. Structured `JobPosting` data is decisive. Without it, multiple independent signals are required: detail URL, unique ID, title, apply action, location/type, substantial description, and job breadcrumb.

Source-specific URL contracts are used for Drushim, GotFriends, SQLink, DevJobs, JobMaster, Nisha, Jobify, Employbl, and Ethosia. Discovery/category links never proceed directly to persistence.

## ATS discovery

Career pages are inspected for Greenhouse, Lever, Ashby, Comeet, and Workable identifiers. Discoveries are stored in `AtsSourceConfiguration`. Greenhouse, Lever, Ashby, and Workable merge high-confidence discovered boards with explicit environment configuration on later collection runs. Comeet remains token-based because its public API requires both a company UID and a careers token.

## Quality and filtering

Quality states are:

- `HIGH_CONFIDENCE`
- `MEDIUM_CONFIDENCE`
- `NEEDS_ENRICHMENT`
- `REJECTED`

Explicit foreign locations take precedence over incidental country words in the description. `Remote - Poland`, for example, is ineligible even when the body mentions Israel. A remote role with no country is `NEEDS_VERIFICATION`, not automatically eligible.

The preference filter produces a check-by-check decision (`PASS`, `FAIL`, or `UNKNOWN`) for excluded keywords, title stopwords, company blacklist, remote policy, role, location, technology, and published date. Enable `JOB_FILTER_DEBUG=true` to print these explanations.

## Source plan and current status

| Priority | Sources | Strategy |
|---|---|---|
| P0 | Lever, Ashby, Comeet, Workable | Official public ATS APIs; configured/discovered accounts |
| P0 | Drushim, GotFriends, SQLink | Strict detail URL discovery followed by detail parsing |
| P1 | DevJobs, AllJobs, JobMaster, Nisha | Strict source contracts plus detail-page structured/DOM extraction |
| P2 | Jobify, Employbl, Ethosia | Detail URL contracts; missing fields stay unknown |
| Existing | LinkedIn, Greenhouse | Existing source flow retained; normalized quality metadata added centrally |
| Supplemental | Company career pages | ATS discovery first; custom browser parsing only when no ATS is detected |

SQLink currently exposes category pages without stable detail links in the inspected public markup. The provider reports zero jobs with `NO_DETAIL_URLS_ON_CATEGORY_PAGES` instead of creating false vacancies. Unconfigured Ethosia/ATS accounts report a clear skip and do not affect other sources.

## Live verification, 5 October 2026

The read-only audit script (`pnpm --dir backend run audit:sources -- SOURCE[,SOURCE]`) opens source pages, runs the same provider extraction code, and prints counts and sample fields without persisting vacancies.

| Source | Discovery/detail result | Field findings |
|---|---|---|
| Greenhouse | 264 official API records, 264 detail records | Required fields present; location/date semantics still require the normal preference and quality filters |
| Lever, Ashby, Comeet, Workable | 0 | No accounts configured or discovered yet; clean skips |
| DevJobs | 60 discovered links, 3/3 inspected details | Company/location/description present; publication date absent |
| Drushim | 22 discovered detail links, 2/2 JSON-LD details | Title/company/location/date/description present; anonymized employers and ISO country codes need careful confidence handling |
| GotFriends | 45 discovered detail links, 2/2 inspected details | Full description and region present; employer and date withheld by site |
| JobMaster | 22 discovered links, 3/3 inspected details | Full description present; company/location/date unavailable in inspected markup, so `NEEDS_ENRICHMENT` |
| Nisha | 8 genuine detail links from high-tech category, 2/2 inspected details | Date and description present; employer/location withheld; previous `/positions/...` category false positives fixed |
| SQLink | No stable job-detail links observed | Category links and numeric PDF media links rejected |
| Jobify, Employbl | 0 current detail links from configured public entry pages | No synthetic vacancies emitted |
| Ethosia | 0 | Search URL not configured |
| AllJobs | Current public search page intermittently redirects to a `Radware Page` | Search failures are isolated; only `/Search/UploadSingle.aspx?JobID=<number>` may enter detail parsing. No current result is claimed from the blocked page. |

The live audit exposed and led to fixes for cross-context Playwright callbacks in Drushim/GotFriends, Nisha category links and false company text, SQLink PDFs, and query-based identity collisions for AllJobs/JobMaster. Each provider reports rejected examples and extraction counts. These live counts are diagnostic snapshots, not a promise that third-party sites will expose the same data on later runs.

A second live check from the rebuilt backend container found 8 Nisha detail links and successfully parsed 2/2 inspected pages. Both were classified as real job details with no fabricated employer or location; their missing fields correctly produced `NEEDS_ENRICHMENT`. The backend health endpoint returned OK and the frontend returned HTTP 200.

### Historical database audit

The existing database contained 3,529 pre-migration job records. A read-only SQL inspection found one obvious navigation title and four records where the aggregator name was stored as the employer. These were the same four old Nisha/Employbl category URLs, not newly parsed detail pages. They each had an `ANALYZED` user match, so a targeted migration retains the records and user analyses but clears the fabricated employer, marks ingestion quality `REJECTED`, and excludes them from top-job recommendations and missing-job analysis. The remaining historical records have no new ingestion metadata yet; duplicates receive missing verified fields when revisited by a provider. The audit also found 156 descriptions shorter than 80 characters (125 Glassdoor, 31 LinkedIn); those historical records need source-specific re-enrichment, not synthetic text. No future publication dates or explicit foreign locations were found in this snapshot. The new detail-first collectors prevent these category pages from being saved again, and duplicate enrichment fills verified fields without overwriting a longer stored description.

## Verification

Unit tests use saved HTML fixtures and source URL examples; they never depend on live sites. Live provider checks are separate operational diagnostics because third-party markup, authentication, rate limits, and availability can change independently of the application.

The fixture suite verifies JSON-LD precedence, malformed structured data fallback, page categories, per-source URL contracts, ATS detection, explicit foreign geography, non-fabricated optional fields, source-name company rejection, title-first role matching, and transparent unknown date/location decisions.
