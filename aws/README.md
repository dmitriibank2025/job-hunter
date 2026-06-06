# AWS Deployment

The application is split into two deployable services:

- `backend`: Express API, Prisma, PostgreSQL, Playwright providers, OpenAI integration.
- `frontend`: React/Vite dashboard served by nginx. It talks to the backend through `JOB_HUNTER_API_BASE_URL`.

## Recommended AWS Shape

- Backend: ECS Fargate service or App Runner service.
- Frontend: S3 + CloudFront, or the provided nginx container on ECS/App Runner.
- Database: Amazon RDS PostgreSQL.
- Secrets: AWS Secrets Manager or SSM Parameter Store.
- Runtime files: mount EFS or another persistent volume at `STORAGE_DIR`. Current local `storage/` is ignored and should not be committed.

## Backend Environment

Required:

- `DATABASE_URL`
- `OPENAI_API_KEY`
- `PORT=4000`
- `SERVE_FRONTEND=false`
- `CORS_ORIGIN=https://your-frontend-domain`
- `STORAGE_DIR=/app/storage`
- `ENABLE_SEED_ENDPOINT=false`

Recommended:

- `ACTIVE_PROVIDERS=LINKEDIN,CENTER_ISRAEL`
- `DAILY_JOB_REPORT_ENABLED=true`
- `JOB_REPORT_CRON=0 9 * * *`
- `JOB_REPORT_TIMEZONE=Asia/Jerusalem`
- `PROVIDER_HEADLESS=true`
- `PROVIDER_FETCH_DETAILS=false`

Optional:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`
- `LINKEDIN_EMAIL`
- `LINKEDIN_PASSWORD`

## Frontend Environment

- `JOB_HUNTER_API_BASE_URL=https://your-backend-domain`

## Local AWS-like Smoke Test

```bash
docker compose -f docker-compose.aws.yml up --build
```

Frontend: `http://localhost:8080`

Backend: `http://localhost:4000/health`

## Image Build

Backend:

```bash
docker build -f backend/Dockerfile -t job-hunter-backend .
```

Frontend:

```bash
docker build -f frontend/Dockerfile -t job-hunter-frontend .
```

Push both images to ECR, then configure ECS/App Runner services with the environment above.

For ECS, mount EFS to the backend container and set `STORAGE_DIR` to the mounted path if generated documents must persist.
