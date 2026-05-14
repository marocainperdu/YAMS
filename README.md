# YAMS — Yet Another Minecraft Server Manager

A self-hosted web UI and REST API for managing Minecraft servers.
Run multiple servers, stream their consoles in real-time, manage files,
backups, and worlds — all from a browser.

## Features

- **Server lifecycle** — create, start, stop, delete servers
- **Real-time console** — WebSocket log streaming + send commands
- **File manager** — browse, upload, download, rename, delete
- **Backups** — create, list, download, restore ZIP archives
- **World manager** — list, import, export, switch active world
- **Metrics** — live CPU / RAM / TPS / player counts per server
- **RBAC** — three roles: `admin`, `operator`, `user`
- **2FA** — TOTP (Google Authenticator, Authy, etc.)
- **JWT auth** — short-lived access tokens + rotating refresh tokens
- **Swagger UI** — interactive API docs at `/api-docs`

## Quick Start (Docker)

**1. Create a `.env` file** (copy `.env.example`):

```sh
cp .env.example .env
```

Fill in the three required values:

```env
JWT_SECRET=<run: openssl rand -hex 32>
YAMS_ADMIN_USERNAME=admin
YAMS_ADMIN_PASSWORD=<your password>
```

**2. Start:**

```sh
docker compose up -d
```

YAMS is now running at `http://localhost:3000`.
The admin account is created automatically on first boot.

**3. Place your `server.jar`** in the volume mounted at `/app/servers/<server-id>/`
(shown in the UI when you create a server).

> **Note:** `network_mode: host` is used so Minecraft server ports are
> reachable from the host without declaring them in advance. YAMS itself
> binds to `127.0.0.1:3000` by default — only accessible from the machine
> running Docker. To expose it on the network, set `BIND_ADDRESS=0.0.0.0`
> in your `.env` and put a reverse proxy (Caddy, nginx) with TLS in front.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `JWT_SECRET` | yes (auth on) | — | Secret for signing JWTs. Generate with `openssl rand -hex 32` |
| `YAMS_ADMIN_USERNAME` | yes (first boot) | — | Admin username created on first boot |
| `YAMS_ADMIN_PASSWORD` | yes (first boot) | — | Admin password (min 8 chars) |
| `YAMS_AUTH_ENABLED` | — | `true` in prod | Set to `"true"` to enable JWT auth |
| `PORT` | — | `3000` | HTTP port |
| `BIND_ADDRESS` | — | `127.0.0.1` | Interface to bind. `0.0.0.0` = all interfaces |
| `YAMS_DB` | — | `/app/data/yams.db` | SQLite database path |
| `YAMS_SERVERS_ROOT` | — | `/app/servers` | Directory where server folders are stored |
| `FILE_UPLOAD_LIMIT` | — | `524288000` (500 MB) | Max upload size in bytes |
| `TOTP_ENCRYPTION_KEY` | — | — | 32-byte hex key for encrypting TOTP secrets at rest |

## Local Development

```sh
# Backend
npm install
npm run dev      # auto-restarts on file changes

# Frontend (separate terminal)
cd client
npm install
npm run dev      # Vite dev server at http://localhost:5173
```

No `.env` needed locally — auth is disabled when `YAMS_AUTH_ENABLED` is not set.

## API

Interactive docs: `http://localhost:3000/api-docs`

All endpoints require a `Bearer <token>` header when auth is enabled.

| Method | Path | Description |
|---|---|---|
| POST | `/auth/login` | Get access + refresh tokens |
| POST | `/auth/refresh` | Rotate refresh token |
| POST | `/auth/logout` | Revoke refresh token |
| POST | `/auth/register` | Create user (admin only) |
| GET | `/servers` | List servers |
| POST | `/servers` | Create server |
| POST | `/servers/:id/start` | Start server |
| POST | `/servers/:id/stop` | Stop server |
| DELETE | `/servers/:id` | Delete server |
| GET | `/servers/:id/files` | List files |
| POST | `/servers/:id/files/upload` | Upload file |
| GET | `/servers/:id/backups` | List backups |
| POST | `/servers/:id/backups` | Create backup |
| POST | `/servers/:id/backups/:id/restore` | Restore backup |
| GET | `/servers/:id/worlds` | List worlds |
| POST | `/servers/:id/worlds/active` | Set active world |
| WS | `/ws?token=<jwt>` | Console stream |

## Security

- Auth is **mandatory** in `NODE_ENV=production` — the app refuses to start without it.
- Uploaded `.jar`, `.sh`, `.exe`, `.bat`, `.cmd`, `.ps1` files are rejected.
- All file paths are resolved and checked against the server root (no path traversal).
- Symlinks are blocked in all file operations.
- JWT tokens carry a `tokenVersion` — `logout-all` invalidates all outstanding tokens immediately.
- Rate limiting on login / refresh endpoints.

## License

MIT — see [LICENSE](LICENSE).
