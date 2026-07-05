FROM node:22-bookworm-slim

WORKDIR /app

ARG INSTALL_PLAYWRIGHT=true

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    openssl ca-certificates wget \
    libreoffice-writer fonts-dejavu-core fonts-liberation \
    xvfb x11vnc novnc websockify \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json ./backend/package.json
COPY backend/prisma ./backend/prisma

RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter job-hunter-backend...

# Optional heavy runtime for PDF rendering and browser-based providers.
# Default image stays light; build with --build-arg INSTALL_PLAYWRIGHT=true when needed.
RUN if [ "$INSTALL_PLAYWRIGHT" = "true" ]; then \
      pnpm --dir backend exec playwright install --with-deps chromium; \
    fi

COPY backend ./backend

WORKDIR /app/backend

RUN pnpm prisma generate
RUN pnpm build

EXPOSE 4000

# Migrations are intentionally NOT run here.
# Run them before deploying via:
#   docker run --rm <image> sh -c "pnpm prisma migrate deploy"
# or use the migrate service in docker-compose.yml.
CMD ["pnpm", "start"]
