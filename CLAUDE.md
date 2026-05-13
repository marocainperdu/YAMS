# YAMS — Context Index

Yet Another Minecraft Server Manager. Node.js/Express backend + React frontend + SQLite + WebSocket.

## Rules
- Never assume context is loaded. Load specific files below.
- Prefer loading one context file over reading multiple source files.
- Answers must be implementation-focused, not theoretical.
- Keep this file under 1k tokens. Move detail to docs/context/*.

## Context Files
| File | Load When |
|---|---|
| [docs/context/architecture.md](docs/context/architecture.md) | Tech stack, DB schema, data flows, design decisions |
| [docs/context/api.md](docs/context/api.md) | Route list, request/response formats, auth requirements |
| [docs/context/conventions.md](docs/context/conventions.md) | Naming, layers, error handling, testing, security practices |
| [docs/context/bugs.md](docs/context/bugs.md) | Known bugs, edge cases, security issues |
| [docs/context/roadmap.md](docs/context/roadmap.md) | Short/mid/long term goals, what's done |
| [docs/context/state.md](docs/context/state.md) | Current feature, branch status, next tasks, blockers |
| [docs/context/query_map.md](docs/context/query_map.md) | Which files to load per task type |

→ Use [docs/context/query_map.md](docs/context/query_map.md) to find the right file for any task.

## State (Summary)
See [docs/context/state.md](docs/context/state.md) for full detail.

- **Branch:** `fix-account` — 2FA implementation complete, not merged
- **Next:** audit path traversal (BUG-004), fix email change auth (BUG-002), persist TOTP lockout (BUG-001)
- **Main stable features:** server lifecycle, WebSocket streaming, file/backup/world management, RBAC, JWT+2FA auth

## Security Rules
- No hardcoded secrets. All secrets from env vars — fail fast if missing when auth enabled.
- Always validate and sanitize file paths (normalize + boundary check against server root).
- JWT verification must specify `algorithms: ['HS256']` explicitly.
- Never expose `password_hash`, `totp_secret`, or `totp_last_code` in API responses.
- Rate-limit all unauthenticated mutation endpoints.
- Flag any pattern that deviates from these before implementing.

## Maintenance Rules
- Update [docs/context/state.md](docs/context/state.md) at end of each session.
- Append to [docs/progress.md](docs/progress.md) when features land or bugs are fixed.
- Never duplicate information across context files.
- Keep this file under 1k tokens.
