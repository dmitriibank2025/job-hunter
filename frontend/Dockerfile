FROM node:22-alpine AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json ./frontend/package.json
RUN corepack enable \
  && corepack prepare pnpm@10.13.1 --activate
RUN pnpm install --frozen-lockfile --filter job-hunter-frontend...

COPY frontend ./frontend

WORKDIR /app/frontend
RUN pnpm run build

FROM nginx:1.27-alpine

COPY frontend/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80

CMD ["sh", "-c", "envsubst '$JOB_HUNTER_API_BASE_URL' < /usr/share/nginx/html/runtime-config.js > /usr/share/nginx/html/runtime-config.tmp.js && mv /usr/share/nginx/html/runtime-config.tmp.js /usr/share/nginx/html/runtime-config.js && nginx -g 'daemon off;'"]
