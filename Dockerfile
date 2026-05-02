# ── Stage 1: backend native dependencies ─────────────────────────────────────
# better-sqlite3 requires compilation on Alpine (musl libc — no prebuilt binary).
# Build tools are kept in this stage only; the runtime image stays lean.
FROM node:22-alpine AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

# OpenJDK 21 JRE — required to spawn Minecraft server JVM processes
RUN apk add --no-cache openjdk21-jre

WORKDIR /app

# Pre-compiled backend dependencies from the deps stage
COPY --from=deps /app/node_modules ./node_modules

# Application source
COPY app.js ./
COPY src/ ./src/

# Frontend — plain static files, no build step required
COPY client/dist/ ./client/dist/

# Create runtime directories (actual data comes from mounted volumes)
RUN mkdir -p /app/data /app/servers \
 && chown -R node:node /app

USER node

ENV PORT=3000 \
    YAMS_DB=/app/data/yams.db \
    YAMS_SERVERS_ROOT=/app/servers \
    NODE_ENV=production

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/metrics || exit 1

CMD ["node", "app.js"]
