# syntax=docker/dockerfile:1
# Node 22 LTS (Node 20 reached end-of-life in April 2026).
ARG NODE_IMAGE=node:22-bookworm-slim

# ---------- 1. Build the React web page ----------
FROM ${NODE_IMAGE} AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---------- 2. Build the server (TypeScript + native better-sqlite3) ----------
FROM ${NODE_IMAGE} AS server
ENV PUPPETEER_SKIP_DOWNLOAD=true
WORKDIR /app
# Build tools only in case no prebuilt better-sqlite3 binary matches; they stay out of the final image.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---------- 3. Runtime ----------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    TZ=Asia/Colombo \
    PORT=3100 \
    DATA_DIR=/app/data \
    WWEBJS_AUTH_DIR=/app/.wwebjs_auth \
    WWEBJS_CACHE_DIR=/app/.wwebjs_cache

# Debian's Chromium (kept up to date by Debian security) + fonts so WhatsApp Web renders properly.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates \
      tzdata \
      fonts-liberation \
      fonts-noto-core \
      fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --chown=node:node package.json ./
COPY --from=server --chown=node:node /app/node_modules ./node_modules
COPY --from=server --chown=node:node /app/dist ./dist
COPY --from=web --chown=node:node /web/dist ./public

# Volume mount points owned by the non-root user (new named volumes inherit this ownership).
RUN mkdir -p /app/data /app/.wwebjs_auth /app/.wwebjs_cache \
 && chown -R node:node /app/data /app/.wwebjs_auth /app/.wwebjs_cache

USER node
EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3100)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "dist/index.js"]
