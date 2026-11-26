# 1. Build the React app
FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# 2. Serve the build with nginx; /api is proxied to the backend
FROM nginx:1.29-alpine

# openssl makes the internal HTTPS certificate on first start (docker/10-medbase-cert.sh)
RUN apk add --no-cache openssl

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY nginx/staff-app.conf /etc/nginx/snippets/staff-app.conf
COPY --chmod=755 docker/10-medbase-cert.sh /docker-entrypoint.d/10-medbase-cert.sh
COPY --from=build /app/dist /usr/share/nginx/html

# 80: staff app (HTTP), 443: staff app (HTTPS), 81: corridor board
EXPOSE 80 443 81

HEALTHCHECK --interval=5s --timeout=3s --retries=12 \
    CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
