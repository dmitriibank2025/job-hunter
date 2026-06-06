FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates wget \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json ./backend/package.json
COPY backend/prisma ./backend/prisma

RUN corepack enable \
  && corepack prepare pnpm@10.13.1 --activate

RUN pnpm install --frozen-lockfile
RUN pnpm --dir backend exec playwright install --with-deps chromium

COPY backend ./backend

WORKDIR /app/backend

RUN pnpm prisma generate
RUN pnpm build

EXPOSE 4000

CMD ["sh", "-c", "pnpm prisma migrate deploy && pnpm start"]
