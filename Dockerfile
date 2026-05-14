# ── Stage 1: frontend build ───────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /build

# Install dependencies first (separate layer — only re-runs when lock file changes)
COPY client/package.json client/package-lock.json ./
RUN npm ci

# Copy source and build
COPY client/index.html client/vite.config.js client/postcss.config.js client/tailwind.config.js ./
COPY client/src ./src
RUN npm run build
# Output: /build/dist/

# ── Stage 2: backend native dependencies ─────────────────────────────────────
# better-sqlite3 requires compilation on Alpine (musl libc — no prebuilt binary).
# Build tools are kept in this stage only; the runtime image stays lean.
FROM node:22-alpine AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Stage 3: runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

# OpenJDK 21 JRE — required to spawn Minecraft server JVM processes
# su-exec — minimal setuid helper to drop from root to node user in entrypoint
RUN apk add --no-cache openjdk21-jre su-exec

WORKDIR /app

# Pre-compiled backend dependencies from the deps stage
COPY --from=deps /app/node_modules ./node_modules

# Application source
COPY app.js ./
COPY src/ ./src/

# Built frontend served as static files by Express
COPY --from=builder /build/dist ./client/dist

# Create runtime directories (actual data comes from bind mounts)
RUN mkdir -p /app/data /app/servers \
 && chown -R node:node /app

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Entrypoint runs as root briefly to fix bind-mount ownership, then drops to node
USER root

ENV PORT=3000 \
    BIND_ADDRESS=127.0.0.1 \
    YAMS_DB=/app/data/yams.db \
    YAMS_SERVERS_ROOT=/app/servers \
    NODE_ENV=production

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
