# YAMS — Change Log

This file tracks every modification made to the YAMS codebase during development.
Entries are added chronologically, newest at the top.

**Format:** `[YYYY-MM-DD HH:MM] TYPE: description`
**Types:** `INIT` | `FEAT` | `FIX` | `REFACTOR` | `DOCS` | `CHORE`

---

## Changelog

### [2026-04-10 00:45] FIX/REFACTOR: WebSocket console hardening (Step 2 production-ready)
- **Backpressure protection** (CRITICAL): `broadcastToClients()` now checks `ws.bufferedAmount < BACKPRESSURE_BUFFER_LIMIT` before sending — prevents OOM from slow clients accumulating fast logs
- **Pending client timeout** (CRITICAL): clients waiting in `pendingClients` now auto-disconnect after `PENDING_CLIENT_TIMEOUT_MS` (default 5 min) via `ws.pendingTimeout` — prevents indefinite memory leak if server never starts
- **Configuration via env vars**: `LOG_BUFFER_SIZE`, `PENDING_CLIENT_TIMEOUT_MS`, `BACKPRESSURE_BUFFER_LIMIT` are now overridable per-deployment
- **Event emitter foundation** (for future decoupling): `streamEmitter` exported from `serverService` — wsServer listens to `pending_timeout` event to gracefully close zombie clients
- **Error codes** (UX + programmatic handling): all error responses now include `code` field (`INVALID_JSON`, `SERVER_NOT_FOUND`, `INVALID_COMMAND`, `UNKNOWN_ACTION`, etc.) — clients can switch on codes instead of string matching
- **Timeout lifecycle**: `ws.pendingTimeout` is attached in `subscribe()` when client goes pending, cleared in `unsubscribe()`, and cleared on promotion when server starts
- **Improved cleanup**: pending client timeouts are cleared on disconnect, avoiding orphaned timers

### [2026-04-10 00:30] FIX/FEAT: WebSocket console hardening (Step 2 review)
- **Log buffer**: `logs: []` ring buffer (cap 100) added to every Map entry; replayed to late-joining clients as `{ type: "history", data: [...] }`
- **Pending subscriptions**: `pendingClients: Map<serverId, Set<ws>>` — clients can now subscribe to a stopped server; they are promoted to active automatically when `startServer()` runs and receive a `{ type: "status", data: "started" }` push
- **Typed streams**: stdout emits `type: "stdout"`, stderr emits `type: "stderr"` (was both `"log"`)
- **Unified message shape**: every message carries `{ type, serverId, timestamp, data }` — timestamp injected in `send()` helper, serverId in each broadcast
- **`pushLog(id, type, data)`**: single write path for child process output — buffers + broadcasts in one call
- **`subscribe` / `unsubscribe`** replace `addClient` / `removeClient`; `subscribe` returns a discriminated union `{status:'subscribed'|'pending', serverName, logs?}`
- **Re-subscribe allowed**: removed "already subscribed" guard; replaced with unsubscribe-then-subscribe so clients can recover after a server crash without reconnecting the WebSocket
- **Heartbeat**: 30 s ping/pong interval via `ws.ping()`; dead clients (`isAlive=false`) are terminated — `close` event still fires so cleanup runs normally
- **Duplicate listener note**: not actually a bug — listeners attach to a fresh ChildProcess on every `startServer()` call; the `processes.has(id)` guard prevents double-start races

### [2026-04-10 00:00] FEAT: Real-time WebSocket console (Step 2)
- Added `ws` npm package (no native compilation)
- `src/websocket/wsServer.js` — standalone WebSocket server on port 3001 (WS_PORT env var)
- Extended `processes` Map value from `{ child, name }` to `{ child, name, clients: Set }` — zero breaking changes to Step 1 API
- `broadcastToClients(id, msg)` — internal helper; fans out JSON to all OPEN subscribers of a server
- New exports from `serverService.js`: `addClient`, `removeClient`, `sendCommand`
- stdout/stderr handlers now broadcast `{ type: "log", data }` to subscribers in addition to piping to YAMS stdout
- exit/error/stop handlers broadcast `{ type: "status", data: "stopped" }` before clearing the Map entry
- Client protocol: subscribe first with `{ action: "subscribe", serverId }`, then send `{ action: "command", serverId, command }` or receive log/status pushes
- Edge cases handled: non-running server subscribe, multi-client fan-out, disconnect cleanup, invalid JSON, unknown actions

### [2026-04-09 19:00] INIT: Project scaffolded
- Initialized empty Node.js project in `d:/Documents/CODE/YAMS/`
- Chose CommonJS module system for consistency and simplicity
- Created directory structure: `src/{controllers,services,routes,models,utils}`, `servers/`

### [2026-04-09 19:05] FEAT: package.json created
- Dependencies: `express@^4.19.2`, `uuid@^9.0.1`
- SQLite via Node.js built-in `node:sqlite` (stable in Node 24) — **no native compilation, no extra packages**
- Dev script uses `node --watch` (Node 18+ native, no nodemon required)
- `--disable-warning=ExperimentalWarning` added to scripts to suppress cosmetic SQLite warning on some Node 24 builds
- No ORM — raw SQL via prepared statements for clarity

### [2026-04-09 19:06] FIX: Switched from better-sqlite3 to node:sqlite built-in
- `better-sqlite3` requires Visual Studio Build Tools to compile on Windows with Node 24 (no prebuilt binary for target=24.14.0)
- Replaced with `node:sqlite` (Node.js built-in, stable in Node 24, zero native compilation)
- Updated `src/db.js`: `new DatabaseSync(path)` + `db.exec("PRAGMA ...")` instead of `db.pragma(...)`
- Updated `src/models/serverModel.js`: positional `?` parameters throughout (fully compatible with `StatementSync` API)

### [2026-04-09 19:10] FEAT: Error utility (`src/utils/errors.js`)
- `AppError` class with `statusCode` and `isOperational` flag
- Factory functions: `badRequest(400)`, `notFound(404)`, `conflict(409)`, `internal(500)`
- `isOperational=true` marks safe-to-expose client errors; unexpected errors get generic 500

### [2026-04-09 19:15] FEAT: Database layer (`src/db.js`)
- Singleton pattern — one connection shared across the app
- SQLite pragmas: WAL mode (better read concurrency), foreign keys ON
- Schema migration runs on first open; idempotent (`CREATE TABLE IF NOT EXISTS`)
- Schema: `servers` table with id, name, path, port, ram, status (CHECK constraint), pid, timestamps

### [2026-04-09 19:20] FEAT: Server model (`src/models/serverModel.js`)
- All SQL isolated here — controllers and services never write raw SQL
- Prepared statements cached after first call to `getDb()`
- Functions: `create`, `findAll`, `findById`, `findByPort`, `findByName`, `updateStatus`, `remove`
- Returns plain JS objects (no ORM wrappers)

### [2026-04-09 19:25] FEAT: File management utility (`src/utils/fileManager.js`)
- `createServerDirectory` — `fs.mkdirSync` with `{ recursive: true }`
- `writeEula` — generates `eula.txt` with `eula=true` + timestamp comment
- `writeServerProperties` — writes minimal `server.properties` (port, online-mode, motd, etc.)
- `serverJarExists` — boolean check before attempting spawn
- No external dependencies; uses only Node.js built-in `fs` and `path`

### [2026-04-09 19:35] FEAT: Server service (`src/services/serverService.js`) with improved process handling
- Module-level `Map<id, { child, name }>` — in-memory registry of live processes
- **Startup reconciliation**: on module load, any servers marked `running` in DB are reset to `stopped` (handles crash recovery across restarts)
- **Input validation**: name (letter-start, alphanumeric+hyphens, 3–32 chars), port (1024–65535), ram (regex `/^\d+(M|G)$/`)
- **`createServer`**: validates → checks port/name conflicts → disk ops (dir + eula + properties) → DB write. Disk ops before DB write prevents orphaned DB records on FS failure.
- **`startServer`**: checks Map + DB state → verifies `server.jar` exists → spawns `java -Xms{ram} -Xmx{ram} -jar server.jar --nogui` → sets Map entry → updates DB. If DB write fails post-spawn, kills the orphaned process and cleans Map.
- **Process stdio**: stdout/stderr piped and prefixed with server name for visibility in YAMS logs
- **`exit` event handler**: removes from Map, updates DB to stopped — handles both clean exits and crashes
- **`error` event handler**: handles OS-level spawn errors (ENOENT, EACCES)
- **`stopServer`**: removes from Map first (prevents double-update from exit handler) → sends `stop\n` to stdin (graceful Minecraft shutdown, works on all OS) → falls back to `child.kill()` if stdin unavailable → updates DB
- **Windows note**: `child.kill()` calls `TerminateProcess()` (hard kill). The `stop\n` via stdin path is preferred and works cross-platform.

### [2026-04-09 19:50] FEAT: Controller (`src/controllers/serverController.js`)
- Thin handlers: parse request body/params → call service → JSON response
- All errors forwarded via `next(err)` to Express global error handler
- No business logic here; controllers do not touch DB or filesystem directly

### [2026-04-09 19:55] FEAT: Routes (`src/routes/serverRoutes.js`)
- `POST   /servers`        → `controller.create`
- `GET    /servers`        → `controller.list`
- `GET    /servers/:id`    → `controller.getOne`
- `POST   /servers/:id/start` → `controller.start`
- `POST   /servers/:id/stop`  → `controller.stop`

### [2026-04-09 20:00] FEAT: Entry point (`app.js`)
- Imports `db.js` and `serverService.js` at startup (triggers DB init + reconciliation)
- Mounts `/servers` router
- 404 handler for unmatched routes
- Global 4-arg error handler: operational errors → JSON with status code, unexpected errors → log stack + generic 500
- Startup banner lists all available endpoints
- Exported as `module.exports = app` for future testing

### [2026-04-09 20:05] CHORE: Project hygiene
- `.gitignore`: excludes `node_modules/`, `yams.db` + WAL files, server runtime artifacts (world dirs, logs, crash-reports), ban/op/whitelist files
- `CLAUDE.md`: this file

---

## Architecture Decisions

| Decision | Reasoning |
|---|---|
| CommonJS | Simpler for a Node backend; no transpilation needed |
| `better-sqlite3` (synchronous) | All DB ops are fast local reads/writes; sync keeps code readable |
| Prepared statements (no ORM) | Full SQL visibility, no magic, minimal dependencies |
| `Map<id, { child, name }>` in memory | Direct access to ChildProcess for signal/stdin writes |
| Disk ops before DB write in `createServer` | Prevents orphaned DB records on FS failure |
| `stop\n` via stdin before `kill()` | Cross-platform graceful shutdown (preferred over SIGTERM) |
| Startup reconciliation in service module | Ensures DB consistency after any kind of crash |

---

## Known Limitations / Future Work

- **server.jar must be placed manually** by the user in `servers/{name}/`. Future: `POST /servers/:id/download-jar?version=1.21` that fetches from Mojang's version manifest API.
- **No authentication** on any endpoint — this is a local-only tool by design.
- **No WebSocket log streaming** — server output is piped to YAMS's own stdout for now.
- **No port-in-use OS-level check** — only DB-level. A port could be in use by a non-YAMS process.
- **Windows hard kill fallback**: `child.kill()` → `TerminateProcess()` if stdin write fails. Minecraft world may not flush cleanly in that case.
- **No backup/restore, file browser, or plugin management** — out of scope for Step 1.
