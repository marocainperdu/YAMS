# YAMS — Complete System-Wide Security & Architecture Audit

**Branch:** `worlds-backend` | **Date:** 2026-05-13

---

## 🔴 CRITICAL — Must Fix Before Any Public Deployment

---

### CRIT-1: Zero Authentication on ALL REST Endpoints

- **Files:** `app.js:47-51`, every route file
- **Category:** `authentication_bypass`
- **Confidence:** 8/10

**Description:** There is no authentication middleware anywhere in the application. `app.listen(PORT)` binds to `0.0.0.0` (all interfaces — Node.js default when no bind address is given). Every endpoint is reachable by any machine on the same network without credentials.

```js
// app.js — no auth middleware before any route
app.use('/servers', serverRoutes);          // create, start, stop servers
app.use('/servers/:id/files', fileRoutes);  // full filesystem read/write/delete
app.use('/servers/:id/backups', backupRoutes);
app.use('/servers/:id/worlds', worldRoutes);
app.use('/metrics', metricsRoutes);
```

**Exploit Scenario:**
Any machine on the LAN (or internet if the port is reachable) can:
1. `GET /servers` → enumerate all servers and their IDs
2. `POST /servers/:id/stop` → hard-stop any running server
3. `POST /servers` → create new servers, consuming disk space
4. `DELETE /servers/:id/files` with `path: "server.properties"` → delete configuration
5. `POST /servers/:id/backups/:id/restore` → overwrite all server files

**Fix:**
```js
// app.js
const authMiddleware = require('./src/middleware/authMiddleware');

// Bind only to localhost in development
app.listen(PORT, '127.0.0.1', () => { ... });

// Apply auth before all routes
app.use('/servers', authMiddleware, serverRoutes);
app.use('/servers/:id/files', authMiddleware, fileRoutes);
// ...
```

---

### CRIT-2: Zero Authentication on WebSocket Console — Unauthenticated Minecraft Command Injection

- **File:** `src/websocket/wsServer.js:73-74`, `src/websocket/wsServer.js:257-272`
- **Category:** `authentication_bypass`, `command_injection`
- **Confidence:** 9/10

**Description:** The WebSocket server at `/ws` accepts connections from any client with zero authentication. Once connected, an attacker can subscribe to any running server and write arbitrary commands to its stdin.

```js
// wsServer.js:73 — no origin check, no token check, no auth
const wss = new WebSocket.Server({ server: httpServer, path: '/ws' });

// wsServer.js:257 — any command, any server
function handleCommand(ws, msg) {
  sendCommand(serverId, command.trim());  // → child.stdin.write(`${command}\n`)
}
```

**Exploit Scenario:**
```bash
wscat -c ws://192.168.1.x:3000/ws
> {"action":"subscribe","serverId":"<uuid>"}
> {"action":"command","serverId":"<uuid>","command":"stop"}           # server shutdown
> {"action":"command","serverId":"<uuid>","command":"op attacker"}    # grant OP
> {"action":"command","serverId":"<uuid>","command":"ban <player>"}   # ban players
```
Servers with scripting plugins (Skript, PAPI, EssentialsX) may expose console commands that execute OS commands within the JVM.

**Fix:**
```js
// wsServer.js — validate token on HTTP upgrade, before WebSocket handshake
httpServer.on('upgrade', (req, socket, head) => {
  const token = new URL(req.url, 'http://x').searchParams.get('token');
  if (!verifyToken(token)) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
```

---

### CRIT-3: Unauthenticated File Upload Overwrites `server.jar` → RCE on Next Server Start

- **Files:** `src/services/fileService.js:131-229`, `src/services/serverService.js:280-288`
- **Category:** `remote_code_execution`
- **Confidence:** 9/10

**Description:** The file upload endpoint accepts any file type including `.jar` and supports `overwrite=true`. It writes to the server's root directory. The server is started with `spawn('java', ['-jar', 'server.jar'])`. No authentication is required. This is a direct, single-step RCE path.

```js
// fileService.js:155-173 — accepts any filename, any type
bb.on('file', async (fieldname, stream, info) => {
  const filename = path.basename(info.filename || '');
  const { resolved: fp } = resolveSafePath(serverId, path.join(destDir, filename));
  // If overwrite=true, existing file is replaced atomically
  ws = fs.createWriteStream(tmpPath);
  stream.pipe(ws);
});

// serverService.js:280 — next start executes whatever jar is present
child = spawn('java', ['-Xms1G', '-Xmx1G', '-jar', 'server.jar', '--nogui'], {
  cwd: server.path,
});
```

**Exploit Scenario:**
```bash
# 1. Craft a malicious JAR (e.g. reverse shell on static initializer)
# 2. Upload it, overwriting the legitimate server.jar
curl -X POST http://target:3000/servers/<uuid>/files/upload?path=&overwrite=true \
  -F "file=@malicious.jar;filename=server.jar"

# 3. Trigger the server start → executes attacker's JAR
curl -X POST http://target:3000/servers/<uuid>/start
# → java -jar server.jar → attacker's code runs in the YAMS process's security context
```

**Fix:**
1. Require authentication on all file routes (CRIT-1 is the root fix)
2. Deny `.jar` uploads via the file manager — server JARs should be placed manually or via a dedicated versioned endpoint
3. Alternatively, store server JARs in a write-protected directory outside the upload root

---

## 🟠 HIGH

---

### HIGH-1: `internal()` Errors Are `isOperational = true` — Sensitive Details Leaked to API Callers

- **Files:** `src/utils/errors.js:42`, `app.js:85-93`
- **Category:** `data_exposure`
- **Confidence:** 8/10

**Description:** The `internal()` factory creates an `AppError` with `isOperational = true`. The global error handler exposes the full `.message` for all operational errors. This means every `internal(msg)` call leaks its message verbatim in the HTTP response body. The JSDoc on `AppError` says "safe to expose message to the client" — which is correct for 4xx errors but was incorrectly applied to 500s.

```js
// errors.js — internal() is always isOperational=true
const internal = (msg, code) => _make(msg || 'Internal server error', 500, code);
class AppError extends Error {
  constructor(message, statusCode) {
    this.isOperational = true;  // ← always true for every factory, including internal()
  }
}

// app.js — exposes message for ALL operational errors, including 500s
if (err.isOperational) {
  return res.status(err.statusCode).json({ error: err.message });
}
```

**Confirmed leak sites:**

| File | Call | Leaked content |
|------|------|----------------|
| `src/services/worldService.js:604` | `internal('Failed to read server directory: ${err.message}')` | OS errno, filesystem paths |
| `src/services/backupService.js:311` | `internal('Extraction failed: ${err.message}')` | unzipper internals, paths |
| `src/services/serverService.js:312` | `internal('Started java but failed to save state to DB: ${err.message}')` | DB schema details |
| `src/services/serverService.js:215` | `internal('Failed to create server directory: ${err.message}')` | filesystem paths |

**Fix:**
```js
// errors.js — 500s should NOT be operational
const internal = (msg, code) => {
  const e = new Error(msg || 'Internal server error');
  e.statusCode = 500;
  e.isOperational = false;  // ← logged server-side only; generic 500 returned to client
  if (code) e.internalCode = code;
  return e;
};
```

---

### HIGH-2: Backup Restore Uses `unzipper.extract()` — Weaker ZIP Safety Than World Import

- **File:** `src/services/backupService.js:274-312`
- **Category:** `insufficient_validation`
- **Confidence:** 8/10

**Description:** `worldService.importWorld` has layered defenses: per-entry extraction with `O_CREAT | O_EXCL | O_NOFOLLOW`, real-byte zip-bomb counter, post-extraction symlink/hardlink check, and dangerous-extension blocklist. The backup restore uses `unzipper`'s convenience `extract()` method which provides none of those safeguards.

```js
// backupService.js:274-298
// Only a zip-slip path-traversal check — no extension blocklist, no size cap,
// no O_EXCL, no symlink/hardlink post-check
for (const file of zipDir.files) {
  const normalized = path.normalize(file.path);
  if (path.isAbsolute(normalized) || normalized.startsWith('..')) { ... }
}
await zipDir.extract({ path: serverRoot, concurrency: 5 });  // ← unguarded
```

Without authentication (CRIT-1), an attacker can reach this code path with a crafted archive. The missing guards mean the restore can:
- Extract `.sh` scripts into the server directory
- Preserve UNIX symlinks from the archive (unzipper may honour mode bits)
- Write large numbers of files with no count cap
- Overwrite any file in `serverRoot` including `server.jar`

**Fix:** Apply the same entry-by-entry extraction pattern used in `worldService.extractZip()`. Add the `DANGEROUS_EXTENSIONS` check, uncompressed byte counter, and file count cap before calling any extraction method.

---

## 🟡 MEDIUM

---

### MED-1: Auth System Referenced in Audit Spec Does Not Exist on This Branch

- **Category:** `architecture`

The user's audit brief documents JWT, RBAC, TOTP, `YAMS_AUTH_ENABLED`, `authMiddleware`, `permissionMiddleware`, `requireServerPermission`, `seedAdminIfEmpty`, and `authService`. **None of these exist on `worlds-backend`.** The git log confirms these were delivered on the `account` branch (PRs #6, #7) and merged into a different target. The `worlds-backend` branch was not updated to include them.

There is no feature flag, no partial auth, no disabled-but-present middleware. The system is unconditionally unauthenticated.

**Action:** Rebase or merge `main` (which contains the auth layer) into `worlds-backend` before shipping. Ensure worlds and metrics routes are gated behind `authMiddleware` + the appropriate permission check.

---

### MED-2: `WORLD_DIRS` in Backup Service Is Hardcoded — Wrong Worlds Saved/Restored With Custom `level-name`

- **File:** `src/services/backupService.js:16-17`
- **Category:** `data_integrity`

```js
const WORLD_DIRS = ['world', 'world_nether', 'world_the_end'];
```

The `POST /servers/:id/worlds/active` API lets operators change `level-name` in `server.properties` to any valid name (e.g. `survival`). When `restoreBackup()` runs, it only saves/rolls back those three hardcoded directories. If `level-name=survival`:

1. `survival/`, `survival_nether/`, `survival_the_end/` are **not** moved to `.restore-bak`
2. The archive is extracted over them — potentially corrupting them
3. If extraction fails, rollback does not restore the custom-named worlds

**Fix:** Before backup create/restore, read `level-name` from `server.properties` and compute world dirs dynamically:
```js
const levelName = await readLevelName(serverRoot);
const worldDirs = [levelName, `${levelName}_nether`, `${levelName}_the_end`];
```

---

### MED-3: `app.listen(PORT)` Binds to All Interfaces — No Explicit Bind Address

- **File:** `app.js:105`
- **Category:** `network_exposure`

```js
const server = app.listen(PORT, () => { ... });
// Node.js default: binds to 0.0.0.0 (all interfaces)
```

Combined with zero authentication, this exposes the entire API on every network interface including public ones in cloud environments.

**Fix:**
```js
const BIND = process.env.BIND_ADDRESS || '127.0.0.1';
const server = app.listen(PORT, BIND, () => {
  console.log(`[YAMS] Running on http://${BIND}:${PORT}`);
});
```

---

### MED-4: No JSON Body Size Limit

- **File:** `app.js:35`
- **Category:** `hardening`

```js
app.use(express.json());  // defaults to 100 kB — not enforced explicitly
```

The auth branch implemented an explicit limit that never reached this branch. For endpoints like `POST /servers` (name, port, ram), 16 kB is more than enough.

**Fix:**
```js
app.use(express.json({ limit: '16kb' }));
```

---

## 🟢 LOW

---

### LOW-1: No Security Headers

- **File:** `app.js`
- **Category:** `hardening`

No `X-Content-Type-Options`, `X-Frame-Options`, `Content-Security-Policy`, or `Strict-Transport-Security` headers are set. Since the frontend is served from the same Express app, at minimum `X-Content-Type-Options: nosniff` should be present to prevent MIME-sniffing attacks on downloaded server files.

**Fix:** Add `helmet` or a one-liner middleware before routes:
```js
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');
  next();
});
```

---

### LOW-2: `Content-Disposition` Header Uses Unescaped Uploaded Filenames

- **File:** `src/services/fileService.js:123-126`
- **Category:** `header_injection`

```js
const filename = path.basename(resolved);
res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
```

A file uploaded with a name containing `"` (valid on Linux) produces a malformed header. Impact is limited to confused browser behavior (no code execution), but it is trivially avoidable.

**Fix:** Use RFC 5987 encoding:
```js
res.setHeader(
  'Content-Disposition',
  `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(resolved))}`
);
```

---

### LOW-3: CLAUDE.md Documents `node:sqlite` But Code Uses `better-sqlite3`

- **File:** `src/db.js:4`, `CLAUDE.md` (2026-04-09 entry)

The changelog entry says "Switched from better-sqlite3 to node:sqlite built-in" but `db.js` imports `better-sqlite3`. The dependency tree and security posture of the two differ. Update CLAUDE.md or the code to be consistent.

---

## 🧱 ARCHITECTURAL ISSUES

---

### ARCH-1: Auth Was Built on a Separate Branch and Never Integrated

The `account` branch (PRs #6, #7) implemented JWT auth, RBAC, per-server permissions, and TOTP. The `worlds-backend` branch was developed in parallel without pulling in that work. The result: every new feature (worlds, metrics) has zero access control. The `worldController.buildCtx()` already reads `req.user?.id` in anticipation of auth — this code exists but is dead without the middleware.

Before this branch is merged: gate every new route behind `authMiddleware` + the appropriate `requireServerPermission` call.

---

### ARCH-2: No Rate Limiting on Any Endpoint

No throttling exists on any route. Endpoints that have real cost include:
- `POST /servers/:id/start` — spawns a JVM
- `POST /servers/:id/worlds/import` — extracts large ZIPs
- `GET /servers/:id/metrics` — reads from `/proc` on every call
- `POST /servers/:id/backups` — full directory archive

The auth branch added rate limiting for login; the same treatment is needed for destructive endpoints here.

---

### ARCH-3: Backup Restore Is Not Atomic for Custom World Directories

The restore flow (stop → rename worlds to `.restore-bak` → extract → remove bak) is only partially atomic. Steps 2→3 are a window where the server has no world data. A crash in that window, combined with hardcoded `WORLD_DIRS` (MED-2), could leave a server unrecoverable without the backup file.

---

### ARCH-4: `metricsService` State Leaks for Deleted Servers

Maps in `metricsService` (`diskCache`, `tpsUnavailable`, `lastTpsCommand`, etc.) are cleaned up only on `status` events from `streamEmitter`. If a server record is deleted from the DB without going through the stop lifecycle, these entries persist indefinitely. There is no `serverDeleted` event today; this will matter once a `DELETE /servers/:id` endpoint is added.

---

## ✅ WHAT IS SOLID

These components are well-engineered and production-quality:

**World Import (`worldService.importWorld`)** — Excellent layered defense: `O_CREAT | O_EXCL | O_NOFOLLOW` per-file extraction, dual zip-bomb guard (declared + real-byte), symlink/hardlink post-extraction check, forbidden extension blocklist, FIFO mutex with per-server and global depth caps, atomic rename. Best security posture in the codebase.

**SQL Layer** — Prepared statements throughout with no raw string interpolation. Zero SQL injection surface area.

**Path Traversal Protection** — `resolveSafePath()`, `validateServerPath()`, `resolveWorldPath()` all use `path.resolve()` + prefix check. Consistent and correct across `fileService`, `backupService`, and `worldService`.

**Server Process Management** — JVM argument array is built from strictly regex-validated inputs (`validateRam`, `validateName`). No `shell: true`, no string concatenation into a command line. Immune to command injection.

**Symlink Blocking** — Consistent `lstat()` + `isSymbolicLink()` checks, `O_NOFOLLOW` on all file opens in worldService, `rejectSymlink()` / `rejectSymlinkDeep()` in fileService.

**Concurrency** — The worlds FIFO mutex releases correctly in `finally`, has both per-server and global depth caps. Backup service's `activeBackups`/`activeRestores` Sets are populated synchronously before the first `await` — eliminates the classic Node.js race window.

**DB Schema** — `CHECK (status IN ('stopped', 'running'))` prevents invalid states, `UNIQUE` on `name` and `port`, `FOREIGN_KEYS = ON`, WAL mode.

**Metrics Service (new in this branch)** — `/proc` reads are gracefully defensive (`try/catch → null`), sampler intervals are correctly cleaned up on server stop, TPS anti-spam logic is sound, CPU delta calculation is correct.

---

## 🚀 Production Readiness Score: 2 / 10

| Dimension | Score | Notes |
|-----------|-------|-------|
| Authentication | 0/10 | Completely absent |
| Authorization | 0/10 | Completely absent |
| Filesystem Safety | 7/10 | Path guards solid; jar overwrite needs auth fix |
| ZIP Security | 8/10 | World import excellent; backup restore weaker |
| Concurrency | 8/10 | Mutex and atomic ops are correct |
| Error Handling | 5/10 | `internal()` leaks internals to callers |
| Network Hardening | 2/10 | Binds to 0.0.0.0, no headers, no rate limits |
| Data Integrity | 6/10 | Hardcoded WORLD_DIRS is a restoration risk |
| Code Quality | 8/10 | Well-structured, defensive, well-documented |

**Verdict:** This system cannot be deployed publicly. The absence of any authentication layer is the single hard blocker. Everything else is fixable in days; auth integration requires a branch merge and a test cycle.

---

## 🛠️ Patch Plan

| Priority | Issue | Effort |
|----------|-------|--------|
| P0 | Merge auth branch into `worlds-backend`; gate all routes with `authMiddleware` | 1–2 days |
| P0 | Gate WebSocket `/ws` with token-on-upgrade check | 4 hours |
| P0 | Block `.jar` uploads in file API (or auth gates it — P0 above) | 1 hour |
| P1 | Fix `internal()` to set `isOperational = false`; log server-side only | 30 min |
| P1 | Explicit `app.listen(PORT, BIND_ADDRESS)` defaulting to `127.0.0.1` | 15 min |
| P1 | Apply entry-by-entry extraction to `backupService.restoreBackup()` | 4 hours |
| P2 | Read `level-name` dynamically in backup create/restore | 1 hour |
| P2 | Add `express.json({ limit: '16kb' })` | 5 min |
| P2 | Add basic security headers | 30 min |
| P3 | Fix `Content-Disposition` header encoding | 30 min |
| P3 | Add `serverDeleted` event cleanup in `metricsService` | 1 hour |
| P3 | Reconcile CLAUDE.md vs actual SQLite dependency | 5 min |
