# YAMS File Manager API — Design Spec
**Date:** 2026-04-20  
**Status:** Approved

---

## Overview

A production-grade, secure file manager API scoped per Minecraft server. All operations are sandboxed to `{SERVERS_ROOT}/{serverId}/`. The implementation is monolithic (path security + fs ops colocated in `fileService.js`) and integrates cleanly into YAMS's existing thin-controller / service architecture.

---

## Module Structure

```
src/
  services/fileService.js       ← path resolution + all fs.promises operations
  controllers/fileController.js ← HTTP parsing, response formatting, error forwarding
  routes/fileRoutes.js          ← Express Router mounted under /servers/:id/files
```

No new utility file. `resolveSafePath` lives as an unexported internal function inside `fileService.js`.

---

## Path Security (Core Invariant)

Every file operation passes through `resolveSafePath(serverId, userPath)` before touching disk.

```js
function resolveSafePath(serverId, userPath = '') {
  const serverRoot = path.resolve(SERVERS_ROOT, serverId);
  const resolved   = path.resolve(serverRoot, userPath);

  if (resolved !== serverRoot && !resolved.startsWith(serverRoot + path.sep)) {
    throw forbidden('Path escapes server root');
  }
  return { resolved, serverRoot };
}
```

**Rules enforced:**
- `../` traversal → 403
- Absolute paths (e.g. `/etc/passwd`) → 403
- Cross-server access → 403
- Symlinks → 403 (checked via `fs.promises.lstat()` after resolving)
- Operating on server root itself (delete, rename from) → 403

`SERVERS_ROOT` is read from `process.env.YAMS_SERVERS_ROOT` with the same fallback as `serverService.js` (`path.join(__dirname, '..', '..', 'servers')`). Both modules remain independent — no circular import.

---

## API Endpoints

All routes are prefixed `/servers/:id/files` (consistent with existing YAMS convention — no `/api` prefix).

The controller validates that `:id` exists in the DB (`serverModel.findById`) before delegating to the service. If not found → 404.

### 1. List Directory

```
GET /servers/:id/files?path=
```

- `path` defaults to `""` (server root)
- Returns first 1000 entries; if truncated, response includes `"truncated": true`
- Symlinks are skipped silently in listings (not exposed to the client)

**Response:**
```json
{
  "data": [
    { "name": "server.properties", "type": "file", "size": 1234, "modified": 1710000000000 },
    { "name": "world", "type": "directory", "modified": 1710000000000 }
  ],
  "truncated": false
}
```

### 2. Download File

```
GET /servers/:id/files/download?path=
```

- Streams file via `fs.createReadStream` — no buffering
- Sets `Content-Type` via Node's built-in `path.extname` → mime lookup (small inline map; no mime package)
- Sets `Content-Disposition: attachment; filename="<basename>"`
- Rejects directories with 400

### 3. Upload File

```
POST /servers/:id/files/upload?path=&overwrite=true
```

- `Content-Type: multipart/form-data`, file field name: `file`
- `path` query param: destination directory (defaults to server root)
- `overwrite` query param: `true` to allow overwriting; default is `false` → 409 if file exists
- File size limit: `FILE_UPLOAD_LIMIT` env var, default `524288000` (500 MB)
- **Atomic write**: busboy pipes to `<dest>.yams_tmp` → `fs.promises.rename()` to final path
- Partial uploads (busboy abort, size exceeded): temp file deleted, no partial artifact left

### 4. Create Folder

```
POST /servers/:id/files/mkdir
Body: { "path": "plugins/new-folder" }
```

- Uses `fs.promises.mkdir({ recursive: true })`
- Idempotent — if directory already exists, returns 200

### 5. Rename / Move

```
PUT /servers/:id/files/rename
Body: { "from": "plugins/a.jar", "to": "plugins/b.jar" }
```

- Both `from` and `to` pass through `resolveSafePath` independently
- Works across subdirectories within the same server root
- Uses `fs.promises.rename()` — atomic; cross-device moves are impossible since all servers share one `SERVERS_ROOT`

### 6. Delete

```
DELETE /servers/:id/files
Body: { "path": "plugins/a.jar" }
```

- Forbidden if `path` resolves to server root itself → 403
- Removes files (`fs.promises.unlink`) and directories (`fs.promises.rm({ recursive: true, force: true })`)
- Checks whether target is file or directory via `lstat` before dispatching

---

## Error Handling

Uses existing `AppError` factory functions — no new error types.

| Scenario | HTTP | Factory |
|---|---|---|
| Path escapes server root | 403 | `forbidden()` |
| Path is a symlink | 403 | `forbidden()` |
| Delete / list on server root | 403 | `forbidden()` |
| File or directory not found | 404 | `notFound()` |
| Upload file exists, no overwrite flag | 409 | `conflict()` |
| Upload exceeds size limit | 400 | `badRequest()` |
| Missing required field (from/to/path) | 400 | `badRequest()` |
| Directory passed to download | 400 | `badRequest()` |

Note: `forbidden()` factory doesn't exist yet in `errors.js` — add it as `new AppError(msg, 403)`.

---

## Configuration (env vars)

| Variable | Default | Description |
|---|---|---|
| `YAMS_SERVERS_ROOT` | `../../servers` (relative to `src/`) | Root for all server directories |
| `FILE_UPLOAD_LIMIT` | `524288000` (500 MB) | Max upload size in bytes |
| `FILE_LIST_LIMIT` | `1000` | Max entries returned by list |

---

## Upload Streaming Detail (busboy)

```
Request arrives
  → busboy parses multipart stream
  → 'file' event fires; pipe to fs.createWriteStream(<dest>.yams_tmp)
  → track bytes; abort + delete temp if limit exceeded
  → 'close' event: fs.promises.rename(tmp → final)
  → respond 201
```

busboy is already available transitively — confirm with `require('busboy')` before adding to `package.json`. If not resolvable, add explicitly.

---

## Inline Mime Map

Small hardcoded map for the most common Minecraft server file types (no external dependency):

```js
const MIME = {
  '.jar':        'application/java-archive',
  '.json':       'application/json',
  '.properties': 'text/plain',
  '.txt':        'text/plain',
  '.yml':        'text/yaml',
  '.yaml':       'text/yaml',
  '.log':        'text/plain',
  '.zip':        'application/zip',
  '.gz':         'application/gzip',
  '.png':        'image/png',
};
const DEFAULT_MIME = 'application/octet-stream';
```

---

## Route Registration

In `app.js`, mount file routes after server routes:

```js
const fileRoutes = require('./src/routes/fileRoutes');
app.use('/servers', fileRoutes);  // fileRoutes handles /:id/files internally
```

---

## What Is NOT In Scope

- Authentication / authorization (YAMS is local-only by design)
- File editing in-browser (download + re-upload covers this)
- Recursive directory downloads (zip-on-the-fly)
- File search / grep
