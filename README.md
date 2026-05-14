# YAMS — Yet Another Minecraft Server Manager

> A self-hosted web UI and REST API for running and managing multiple Minecraft servers from a single browser tab.

[![Build](https://img.shields.io/github/actions/workflow/status/marocainperdu/YAMS/docker.yml?branch=main&label=build)](https://github.com/marocainperdu/YAMS/actions)
[![Docker Pulls](https://img.shields.io/docker/pulls/momokabil/yams)](https://hub.docker.com/r/momokabil/yams)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.5.0-brightgreen)](package.json)

---

## Table of Contents

- [Description](#description)
- [Features](#features)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Local Development](#local-development)
- [API Reference](docs/API.md)
- [Security](#security)
- [Contributing](#contributing)
- [License](#license)

---

## Description

YAMS lets you spin up, monitor, and control any number of Minecraft servers from a clean web interface — without touching a terminal after the initial setup.

**Why YAMS?** Most Minecraft management panels are either cloud-only, bloated, or require a database server. YAMS runs entirely on a single machine: one Docker container, one SQLite file, zero external dependencies. You own your data.

**How it works:** A Node.js/Express backend manages server processes directly via `child_process`, streams their output over WebSockets, and persists everything to a local SQLite database. A React frontend (served from the same container) connects to that API and provides real-time console access, file management, backups, and more.

**Tech stack:** Node.js 22 · Express · better-sqlite3 · ws · React 18 · Vite · Docker

---

## Features

| Category | What you get |
|---|---|
| **Server lifecycle** | Create, start, stop, delete servers |
| **Real-time console** | Live log streaming over WebSocket + send commands |
| **File manager** | Browse, upload, download, rename, delete files |
| **Backups** | Create, list, download, restore ZIP archives |
| **World manager** | List, import, export, switch active world |
| **Task scheduler** | Cron-based command runner (e.g. auto-restart at 4am) |
| **Webhooks** | Outbound HTTP POST on `server.start`, `server.stop`, `server.crash` |
| **Metrics** | Live CPU / RAM / TPS / player count per server |
| **User management** | Three roles: `admin`, `operator`, `user` |
| **2FA** | TOTP (Google Authenticator, Authy, etc.) |
| **JWT auth** | Short-lived access tokens + rotating refresh tokens |
| **Swagger UI** | Interactive API docs at `/api-docs` |

---

## Quick Start

**Requires:** Docker + Docker Compose

### 1. Create a `.env` file

```sh
cp .env.example .env
```

Open `.env` and fill in three required values:

```env
JWT_SECRET=<run: openssl rand -hex 32>
YAMS_ADMIN_USERNAME=admin
YAMS_ADMIN_PASSWORD=<your password>
```

### 2. Start

```sh
docker compose up -d
```

YAMS is now running at `http://localhost:3000`.
The admin account is created automatically on first boot.

### 3. Add your server JAR

Place your `server.jar` inside the volume mounted at `/app/servers/<server-id>/`
(the exact path is shown in the UI when you create a server).

> **Note on networking:** `network_mode: host` is used so Minecraft server ports (25565, 25566, …) are reachable from the host without declaring them in advance. YAMS itself binds to `127.0.0.1:3000` by default — only accessible from the machine running Docker. To expose it on the network, set `BIND_ADDRESS=0.0.0.0` in your `.env` and put a reverse proxy (Caddy, nginx) with TLS in front.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `JWT_SECRET` | yes | — | Secret for signing JWTs. Generate: `openssl rand -hex 32` |
| `YAMS_ADMIN_USERNAME` | yes (first boot) | — | Admin username created on first boot |
| `YAMS_ADMIN_PASSWORD` | yes (first boot) | — | Admin password (min 8 chars) |
| `YAMS_AUTH_ENABLED` | — | `true` in prod | Set to `"true"` to enable JWT auth |
| `PORT` | — | `3000` | HTTP port |
| `BIND_ADDRESS` | — | `127.0.0.1` | Interface to bind. `0.0.0.0` = all interfaces |
| `YAMS_DB` | — | `/app/data/yams.db` | SQLite database path |
| `YAMS_SERVERS_ROOT` | — | `/app/servers` | Directory where server folders are stored |
| `FILE_UPLOAD_LIMIT` | — | `524288000` (500 MB) | Max upload size in bytes |
| `TOTP_ENCRYPTION_KEY` | — | — | 32-byte hex key for encrypting TOTP secrets at rest |

---

## Local Development

No `.env` needed — auth is disabled when `YAMS_AUTH_ENABLED` is not set.

```sh
# Backend (auto-restarts on file changes)
npm install
npm run dev

# Frontend — separate terminal
cd client
npm install
npm run dev     # Vite dev server at http://localhost:5173
```

---

## API Reference

Full endpoint reference → **[docs/API.md](docs/API.md)**

Interactive docs (with try-it-out): `http://localhost:3000/api-docs`

---

## Security

- Auth is **mandatory** in `NODE_ENV=production` — the app refuses to start without it.
- Uploaded `.jar`, `.sh`, `.exe`, `.bat`, `.cmd`, `.ps1` files are rejected.
- All file paths are resolved and checked against the server root (no path traversal).
- Symlinks are blocked in all file operations.
- JWT tokens carry a `tokenVersion` — logout-all invalidates all outstanding tokens immediately.
- Webhook deliveries include an optional `X-YAMS-Signature: sha256=<hmac>` header for payload verification.
- Rate limiting on login and refresh endpoints.

---

## Docker Hub

Pre-built images: [`momokabil/yams`](https://hub.docker.com/r/momokabil/yams)

Images are built automatically on every push to `main` and on every version tag.

To build from source instead of pulling, replace `image:` with `build: .` in `compose.yml`.

### Release a new version

```sh
git tag v1.0.0
git push origin v1.0.0
```

The workflow builds `momokabil/yams:1.0.0`, `:1.0`, `:1`, and `:latest`.

### Required GitHub secrets (maintainers)

| Secret | Value |
|---|---|
| `DOCKERHUB_USERNAME` | `momokabil` |
| `DOCKERHUB_TOKEN` | Docker Hub access token (Account Settings › Security) |

---

## Contributing

Contributions are welcome. Please open an issue first to discuss what you'd like to change.

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Commit your changes
4. Open a pull request against `dev`

Please follow the existing code style and keep PRs focused on a single concern.

---

## License

MIT — see [LICENSE](LICENSE).
