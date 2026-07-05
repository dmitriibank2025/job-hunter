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

# Only the template is used at runtime — we do NOT copy default.conf so
# the nginx default-conf.d directory starts empty and is fully controlled by CMD.
COPY frontend/nginx/default.conf.template /etc/nginx/default.conf.template
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80

# At startup:
#  1. Derive API_ORIGIN (scheme+host) from JOB_HUNTER_API_BASE_URL.
#  2. Substitute runtime-config.js (frontend API URL).
#  3. Substitute nginx config (CSP connect-src must include the API origin).
CMD ["sh", "-c", \
  "API_ORIGIN=$(echo \"${JOB_HUNTER_API_BASE_URL:-}\" | awk -F/ 'NF>=3{print $1\"//\"$3}') && \
   export API_ORIGIN && \
   envsubst '${JOB_HUNTER_API_BASE_URL}' < /usr/share/nginx/html/runtime-config.js > /tmp/rc.js && \
   mv /tmp/rc.js /usr/share/nginx/html/runtime-config.js && \
   envsubst '${API_ORIGIN}' < /etc/nginx/default.conf.template > /etc/nginx/conf.d/default.conf && \
   echo \"[nginx] CSP connect-src: self ${API_ORIGIN}\" && \
   nginx -g 'daemon off;'"]
