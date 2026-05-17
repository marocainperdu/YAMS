# YAMS — API Reference

All endpoints require `Authorization: Bearer <token>` when auth is enabled.

Interactive docs (with try-it-out): `http://localhost:3000/api-docs`

---

## Table of Contents

- [Auth](#auth)
- [Users](#users)
- [Servers](#servers)
- [Files](#files)
- [Backups](#backups)
- [Worlds](#worlds)
- [Scheduler](#scheduler)
- [Webhooks](#webhooks)
- [Metrics](#metrics)
- [Other](#other)

---

## Auth

| Method | Path | Description |
|---|---|---|
| POST | `/auth/login` | Get access + refresh tokens |
| POST | `/auth/refresh` | Rotate refresh token |
| POST | `/auth/logout` | Revoke refresh token |
| POST | `/auth/logout-all` | Invalidate all tokens for the current user |
| POST | `/auth/register` | Create a user (admin only) |
| PATCH | `/auth/password` | Change own password |

---

## Users

Admin only — requires `admin` role.

| Method | Path | Description |
|---|---|---|
| GET | `/users` | List all users |
| POST | `/users` | Create user |
| PATCH | `/users/:id/role` | Change a user's role |
| DELETE | `/users/:id` | Delete a user |

---

## Servers

| Method | Path | Description |
|---|---|---|
| GET | `/servers` | List servers |
| POST | `/servers` | Create server |
| GET | `/servers/:id` | Get server details |
| DELETE | `/servers/:id` | Delete server |
| POST | `/servers/:id/start` | Start server |
| POST | `/servers/:id/stop` | Stop server |
| GET | `/servers/:id/metrics` | Get live metrics |

---

## Files

| Method | Path | Description |
|---|---|---|
| GET | `/servers/:id/files` | List files at a path |
| POST | `/servers/:id/files/upload` | Upload a file |
| GET | `/servers/:id/files/download` | Download a file |
| POST | `/servers/:id/files/mkdir` | Create a directory |
| PUT | `/servers/:id/files/rename` | Rename a file or folder |
| DELETE | `/servers/:id/files` | Delete a file or folder |

---

## Backups

| Method | Path | Description |
|---|---|---|
| GET | `/servers/:id/backups` | List backups |
| POST | `/servers/:id/backups` | Create a backup (ZIP) |
| GET | `/servers/:id/backups/:backupId/download` | Download a backup |
| POST | `/servers/:id/backups/:backupId/restore` | Restore a backup |
| DELETE | `/servers/:id/backups/:backupId` | Delete a backup |

---

## Worlds

| Method | Path | Description |
|---|---|---|
| GET | `/servers/:id/worlds` | List worlds |
| POST | `/servers/:id/worlds/active` | Set the active world |
| POST | `/servers/:id/worlds/import` | Import a world (ZIP) |
| GET | `/servers/:id/worlds/:name/export` | Export a world as ZIP |
| DELETE | `/servers/:id/worlds/:name` | Delete a world |

---

## Scheduler

Cron expressions follow the standard `minute hour dom month dow` format.
Supported field syntax: `*` (any), `*/N` (every N), `N` (exact), `N,M` (list).

| Method | Path | Description |
|---|---|---|
| GET | `/servers/:id/schedules` | List scheduled tasks |
| POST | `/servers/:id/schedules` | Create a task |
| PATCH | `/servers/:id/schedules/:scheduleId` | Update a task |
| DELETE | `/servers/:id/schedules/:scheduleId` | Delete a task |

**Create / update body:**

```json
{
  "name": "Daily Restart",
  "cron": "0 4 * * *",
  "command": "say Server restarting in 5 minutes",
  "enabled": true
}
```

---

## Webhooks

YAMS fires a `POST` request to registered URLs on server lifecycle events.

**Supported events:** `server.start` · `server.stop` · `server.crash`

**Request headers:**

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `X-YAMS-Event` | Event name (e.g. `server.start`) |
| `X-YAMS-Server-Id` | Server UUID |
| `X-YAMS-Signature` | `sha256=<hmac>` — only present if a secret is configured |

**Payload:**

```json
{
  "event": "server.start",
  "serverId": "uuid",
  "serverName": "My Server",
  "timestamp": 1715000000000
}
```

| Method | Path | Description |
|---|---|---|
| GET | `/servers/:id/webhooks` | List webhooks |
| POST | `/servers/:id/webhooks` | Register a webhook URL |
| PATCH | `/servers/:id/webhooks/:webhookId` | Update a webhook |
| DELETE | `/servers/:id/webhooks/:webhookId` | Delete a webhook |

**Create / update body:**

```json
{
  "url": "https://discord.com/api/webhooks/…",
  "events": ["server.start", "server.crash"],
  "secret": "optional-hmac-secret",
  "enabled": true
}
```

---

## Metrics

| Method | Path | Description |
|---|---|---|
| GET | `/metrics` | Aggregated metrics for all servers |
| GET | `/metrics/:id` | Prometheus-compatible metrics for one server |

---

## Other

| Method | Path | Description |
|---|---|---|
| WS | `/ws?token=<jwt>` | Real-time console stream |
| GET | `/api-docs` | Swagger UI (interactive) |
| GET | `/health` | Health check — returns `{ "status": "ok" }` |
