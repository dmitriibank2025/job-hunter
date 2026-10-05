# Job Hunter

Job Hunter is a split frontend/backend application for collecting software engineering vacancies, analyzing fit, generating tailored resumes and cover letters, and tracking company priority.
It now supports user workspaces with profile data, technology catalog selection, base resumes per target direction, subscription limits, and admin usage reporting.

## October 2026 Reliability Update

The latest two-day release turns the vacancy-to-document workflow into a verified,
observable pipeline rather than a single free-form generation step.

- Resume generation now follows `Job Analyzer -> RAG Query Planner -> pgvector/HNSW retrieval -> Evidence Mapper -> Resume Generator -> deterministic validation -> LLM Critic -> bounded Repair -> deterministic revalidation`. DOCX/PDF rendering starts only after the final factual PASS.
- Stable requirement IDs and claim-level `evidenceIds`, `requirementIds`, `keywords`, and support status make every candidate claim traceable. Unsupported claims, fabricated employer projects, changed employment dates, fake education, and personal-to-commercial experience promotion are hard failures; document quality score remains separate from factual validity.
- The uploaded 2026 base resume is the current source of truth. Role-specific Backend and Frontend bases are activated from the UI, personal AI work remains clearly separated from commercial experience, and edits made in the workspace now feed the selected generation base.
- The Word renderer uses the new base-resume header format: name, target title/stack, and contact/location rows are separated correctly. The city can no longer leak into the name field, and the stack is retained.
- Vacancy ingestion now covers LinkedIn, official company career pages, Greenhouse, Lever, Ashby, Comeet, Workable, DevJobs, AllJobs, Drushim, JobMaster, GotFriends, SQLink, Ethosia, Nisha, Jobify, Employbl, and Glassdoor. Search Preferences lets each user select the active sources.
- Collection is detail-first: pages are classified before parsing, official ATS APIs and `JobPosting` JSON-LD take precedence, source-specific DOM extraction is the fallback, and missing optional fields remain unknown instead of being invented.
- Each job receives field confidence, quality state, Israel/remote eligibility, extraction provenance, deduplication identity, and check-by-check filter decisions. Explicit foreign locations override incidental Israel mentions, and title-first role matching prevents unrelated roles from passing on description keywords alone.
- Existing duplicate records are safely enriched with newly verified fields without replacing a longer saved description. Four legacy Nisha/Employbl category pages were quarantined as rejected while preserving their user analyses.
- PostgreSQL now stores ingestion quality metadata and discovered ATS configurations. Docker migrations, backend/frontend images, health checks, and the source-audit command were verified on the running stack.

Detailed design and operational notes:

- [Evidence-based resume pipeline](RESUME_PIPELINE.md)
- [Job ingestion architecture and live source audit](JOB_INGESTION.md)

## Stack

- Node.js, TypeScript, Express
- Prisma, PostgreSQL
- Playwright providers
- OpenAI API
- Backend API served by Express
- React/Vite frontend dashboard in `frontend/`
- DOCX/PDF resume and cover letter generation

## Product Model

- Users can create a workspace, enter contact details, links, languages, skills, experience, and education.
- Users can create multiple base resumes for different vacancy targets, subject to plan limits.
- LinkedIn search should use a dedicated non-work account. Store passwords in a vault and save only a secret reference in the app.
- Admin users can review user plan, workspace counts, generated resume usage, collected vacancies, and OpenAI token usage.

See [SUBSCRIPTION_LIMITS.md](SUBSCRIPTION_LIMITS.md) for Free/Pro limits and admin metrics.

## Local Setup

1. Install dependencies:

```bash
pnpm install
```

2. Create environment file:

```bash
cp .env.example .env
```

3. Start PostgreSQL locally:

```bash
docker compose up -d postgres
```

4. Apply migrations:

```bash
pnpm run prisma:migrate:deploy
```

5. Start the backend API:

```bash
pnpm run dev:backend
```

Backend: `http://localhost:4000`

6. Start the React frontend in another terminal:

```bash
pnpm run dev:frontend
```

Frontend: `http://localhost:5173`

## Production Build

```bash
pnpm install --frozen-lockfile
pnpm run prisma:migrate:deploy
pnpm run build
pnpm run start:backend
```

## Docker

```bash
docker build -f backend/Dockerfile -t job-hunter-backend .
docker run --env-file .env -p 4000:4000 job-hunter-backend
```

Split frontend/backend local smoke test:

```bash
docker compose -f docker-compose.aws.yml up --build
```

Frontend: `http://localhost:8080`

Backend: `http://localhost:4000/health`

## Required Environment

Set these in the deploy platform:

- `DATABASE_URL`
- `OPENAI_API_KEY`
- `PORT`
- `SERVE_FRONTEND=false`
- `CORS_ORIGIN`
- `STORAGE_DIR`
- `JOB_REPORT_CRON`
- `JOB_REPORT_TIMEZONE`
- `ACTIVE_PROVIDERS`

Supported vacancy sources:

- primary: `LINKEDIN`;
- official company pages: `CENTER_ISRAEL`;
- official ATS feeds: `GREENHOUSE`, `LEVER`, `ASHBY`, `COMEET`, `WORKABLE`;
- Israeli boards/recruiters: `DEVJOBS`, `ALLJOBS`, `DRUSHIM`, `JOBMASTER`, `GOTFRIENDS`, `SQLINK`, `ETHOSIA`, `NISHA`;
- supplementary aggregators: `JOBIFY`, `EMPLOYBL`, `GLASSDOOR`.

Official ATS feeds are company scoped. Configure `GREENHOUSE_BOARD_TOKENS`,
`LEVER_SITES`, `ASHBY_JOB_BOARDS`, and `WORKABLE_ACCOUNTS` with entries in the
form `Company name|board-slug`, separated by semicolons or new lines. Lever may
use `Company name|board-slug|eu`. Comeet uses
`Company name|company-uid|public-careers-token`. Missing ATS configuration is
treated as a clean skip. Browser-board entry points can be overridden through
the corresponding `*_SEARCH_URLS` variables shown in `.env.example`.

The example configuration includes the currently active `Nuvei|nuvei`
Workable board. The collector supports both Workable's current top-level
`city`/`state`/`country` and `published_on` fields and its older nested
`location` response shape.

Put these values in the repository-root `.env` file (not in the frontend):

```env
LEVER_SITES=Company A|company-a;Company B|company-b|eu
ASHBY_JOB_BOARDS=Company A|company-a
WORKABLE_ACCOUNTS=Company A|company-a
COMEET_ACCOUNTS=Company A|company-uid|public-careers-token
```

The Search Sources controls in the UI only enable or disable configured
providers for a run. They do not manage ATS accounts. Restart the backend after
changing `.env` (`docker compose up -d backend`). Company-career-page discovery
can add high-confidence Greenhouse, Lever, Ashby, and Workable boards to the
database automatically; Comeet still needs its public careers token explicitly.

Ethosia currently redirects public job search to an authenticated Bright.source
session, so its adapter remains disabled until `ETHOSIA_SEARCH_URLS` points to an
authorized search entry point; the marketing homepage is intentionally not
treated as a vacancy feed.

Frontend:

- `JOB_HUNTER_API_BASE_URL`

Optional integrations:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`
- `LINKEDIN_EMAIL`
- `LINKEDIN_PASSWORD`

For multi-user LinkedIn search, prefer per-user secret references through the user workspace instead of shared environment credentials.

## Git Safety

Do not commit:

- `.env`
- `storage/`
- generated resumes, cover letters, PDFs, DOCX files
- browser cookies/auth state
- `.idea/`
- `dist/`
- `work/` local smoke-test and rendered QA artifacts

These are ignored by `.gitignore`.
