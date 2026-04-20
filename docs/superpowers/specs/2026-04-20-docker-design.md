# Docker Compatibility — Design Spec

**Date:** 2026-04-20  
**Status:** Approved

## Goal

Make YAMS deployable via Docker for both local development machines and remote servers (VPS/homelab), fully self-contained with no external reverse proxy required.

## Constraints

- Two ports: `3000` (HTTP + static frontend) and `3001` (WebSocket)
- Java must be available in the container (backend spawns Minecraft JVM child processes)
- `servers/` directory must persist on the host (user places `server.jar` files there)
- SQLite database must survive container restarts
- No behaviour change to the local dev workflow (Vite dev server still works as-is)

## Approach: Single multi-stage container + Compose

One `Dockerfile`, one `compose.yml`. `docker compose up -d` is the only command a user needs.

## Files

| File | Action | Purpose |
|---|---|---|
| `Dockerfile` | Create | Multi-stage build |
| `compose.yml` | Create | Volumes, ports, env, restart policy |
| `.dockerignore` | Create | Trim build context |
| `app.js` | Modify | Serve built frontend as static files |
| `client/vite.config.js` | Modify | Read API proxy target from env var |

## Dockerfile

**Stage 1 — frontend builder** (`node:22-alpine`)

1. `WORKDIR /build`
2. Copy `client/package.json` + `client/package-lock.json`, run `npm ci`
3. Copy `client/src`, `client/index.html`, `client/vite.config.js`, `client/postcss.config.js`, `client/tailwind.config.js`
4. Run `npm run build` → produces `client/dist/`

**Stage 2 — runtime** (`node:22-alpine`)

1. Install OpenJDK 21 JRE via `apk add --no-cache openjdk21-jre`
2. `WORKDIR /app`
3. Copy `package.json` + `package-lock.json`, run `npm ci --omit=dev`
4. Copy backend source (`app.js`, `src/`)
5. Copy built frontend from Stage 1: `COPY --from=builder /build/client/dist ./client/dist`
6. Create `/app/data` and `/app/servers` directories
7. Use built-in `node` user: `USER node`
8. `EXPOSE 3000 3001`
9. `CMD ["node", "app.js"]`

**Environment variables with defaults:**

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Express HTTP port |
| `WS_PORT` | `3001` | WebSocket server port |
| `YAMS_DB` | `/app/data/yams.db` | SQLite database path |
| `YAMS_SERVERS_ROOT` | `/app/servers` | Minecraft server directories root |

## compose.yml

```yaml
services:
  yams:
    build: .
    ports:
      - "3000:3000"
      - "3001:3001"
    volumes:
      - ./servers:/app/servers
      - yams_data:/app/data
    environment:
      - PORT=3000
      - WS_PORT=3001
      - YAMS_DB=/app/data/yams.db
      - YAMS_SERVERS_ROOT=/app/servers
    restart: unless-stopped

volumes:
  yams_data:
```

`servers/` is a bind mount so users can place `server.jar` files from the host. The DB lives in a named volume so it survives `docker compose down`.

## .dockerignore

Excludes from build context:
- `node_modules/`, `client/node_modules/`, `client/dist/`
- `servers/` (bind-mounted at runtime)
- `yams.db*` (volume-managed at runtime)
- `.git/`, `docs/`, `*.log`, `.env`

## app.js changes

After all API routes, before the error handler, add static file serving:

```js
const path = require('path')

// Serve built frontend — only active when client/dist exists (Docker / manual build)
app.use(express.static(path.join(__dirname, 'client/dist')))
// SPA fallback: unmatched GETs return index.html so client-side routing works
app.get('*', (_req, res) =>
  res.sendFile(path.join(__dirname, 'client/dist/index.html'))
)
```

This is a no-op in local dev (directory doesn't exist), so the Vite dev server workflow is unchanged.

## client/vite.config.js changes

The proxy target should read from an environment variable so it can be overridden without editing the file:

```js
proxy: {
  '/api': {
    target: process.env.VITE_API_URL || 'http://localhost:3000',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api/, '')
  }
}
```

The current hardcoded target (`http://localhost:3002`) is corrected to `3000` (the actual backend port) as part of this change.

## Data persistence

| Data | Mount type | Host path | Container path |
|---|---|---|---|
| SQLite DB | Named volume | `yams_data` | `/app/data/yams.db` |
| Server files | Bind mount | `./servers` | `/app/servers` |

## Local dev workflow (unchanged)

```bash
# Still works exactly as before
node app.js          # backend on :3000, WS on :3001
cd client && npm run dev  # frontend dev server on :5173
```

## Docker workflow

```bash
# First run (or after code changes)
docker compose up --build -d

# Subsequent starts
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

## Security notes

- Container runs as the built-in non-root `node` user
- No secrets or credentials required (local-only tool by design)
- Minecraft server ports (25565 etc.) are not exposed by Docker — Minecraft binds to those ports inside the container but they are not mapped. If a user wants players to connect, they must add port mappings to `compose.yml` themselves.
