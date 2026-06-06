# Job Hunter

Job Hunter is a split frontend/backend application for collecting software engineering vacancies, analyzing fit, generating tailored resumes and cover letters, and tracking company priority.
It now supports user workspaces with profile data, technology catalog selection, base resumes per target direction, subscription limits, and admin usage reporting.

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

These are ignored by `.gitignore`.
