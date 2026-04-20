# File Manager API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure, sandboxed file manager API to YAMS under `/servers/:id/files` with list, download, upload, mkdir, rename, and delete operations, all sandboxed per server.

**Architecture:** Monolithic service (`fileService.js`) owns all path resolution and `fs.promises` operations; a thin controller parses HTTP and formats responses; a Router with `mergeParams: true` connects the two. Path security is enforced by a single internal `resolveSafePath` function that every operation calls before touching disk.

**Tech Stack:** Node.js `fs.promises`, `busboy` (streaming multipart), Express Router, Node.js built-in `node:test` + `node:assert/strict`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/utils/errors.js` | **Modify** | Add `forbidden()` factory (403) |
| `src/services/fileService.js` | **Create** | Path resolution + all 6 fs operations |
| `src/controllers/fileController.js` | **Create** | HTTP parsing, response formatting |
| `src/routes/fileRoutes.js` | **Create** | Route definitions (`mergeParams: true`) |
| `app.js` | **Modify** | Mount file routes + add to startup banner |
| `test.js` | **Create/Modify** | File manager unit + security tests |

---

### Task 1: Add `forbidden()` to `errors.js`

**Files:**
- Modify: `src/utils/errors.js`
- Test: `test.js`

- [ ] **Step 1: Write the failing test**

If `test.js` does not exist, create it. If it exists, append this block:

```js
'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

// ─── errors.js ────────────────────────────────────────────────────────────────
test('forbidden() returns AppError with statusCode 403', () => {
  const { forbidden } = require('./src/utils/errors');
  const err = forbidden('Access denied');
  assert.equal(err.statusCode, 403);
  assert.equal(err.isOperational, true);
  assert.equal(err.message, 'Access denied');
});

test('forbidden() uses default message when none provided', () => {
  const { forbidden } = require('./src/utils/errors');
  const err = forbidden();
  assert.equal(err.statusCode, 403);
  assert.equal(err.message, 'Forbidden');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test test.js
```

Expected: FAIL — `forbidden is not a function` or `Cannot destructure property 'forbidden'`

- [ ] **Step 3: Add `forbidden()` to `src/utils/errors.js`**

After the `conflict` line add:

```js
/** 403 Forbidden */
const forbidden = (msg) => new AppError(msg || 'Forbidden', 403);
```

Update `module.exports`:

```js
module.exports = { AppError, badRequest, notFound, conflict, forbidden, internal };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test test.js
```

Expected: 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/errors.js test.js
git commit -m "feat: add forbidden() error factory and initial test setup"
```

---

### Task 2: Create `fileService.js` — path security + `listDirectory`

**Files:**
- Create: `src/services/fileService.js`
- Test: `test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test.js`:

```js
// ─── fileService: test setup ──────────────────────────────────────────────────
const os  = require('node:os');
const path = require('node:path');
const fs   = require('node:fs');
const fsp  = require('node:fs/promises');

// Set YAMS_SERVERS_ROOT BEFORE requiring fileService so SERVERS_ROOT is correct.
const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'yams-test-'));
process.env.YAMS_SERVERS_ROOT = TEST_ROOT;

const TEST_SERVER_ID = 'srv-test-001';

async function setupServerDir(serverId = TEST_SERVER_ID) {
  const dir = path.join(TEST_ROOT, serverId);
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

process.on('exit', () => {
  try { fs.rmSync(TEST_ROOT, { recursive: true, force: true }); } catch {}
});

// ─── listDirectory ────────────────────────────────────────────────────────────
test('listDirectory returns files and directories with correct shape', async () => {
  const { listDirectory } = require('./src/services/fileService');
  const dir = await setupServerDir();

  await fsp.writeFile(path.join(dir, 'server.properties'), 'server-port=25565');
  await fsp.mkdir(path.join(dir, 'world'), { recursive: true });

  const result = await listDirectory(TEST_SERVER_ID, '');
  const names  = result.data.map(e => e.name);

  assert.ok(names.includes('server.properties'));
  assert.ok(names.includes('world'));

  const file   = result.data.find(e => e.name === 'server.properties');
  const folder = result.data.find(e => e.name === 'world');

  assert.equal(file.type, 'file');
  assert.ok(typeof file.size === 'number');
  assert.ok(typeof file.modified === 'number');
  assert.equal(folder.type, 'directory');
  assert.equal(typeof result.truncated, 'boolean');
});

test('listDirectory rejects path traversal with 403', async () => {
  const { listDirectory } = require('./src/services/fileService');
  await setupServerDir();

  await assert.rejects(
    () => listDirectory(TEST_SERVER_ID, '../other-server'),
    (err) => err.statusCode === 403
  );
});

test('listDirectory rejects absolute path with 403', async () => {
  const { listDirectory } = require('./src/services/fileService');
  await setupServerDir();

  await assert.rejects(
    () => listDirectory(TEST_SERVER_ID, '/etc/passwd'),
    (err) => err.statusCode === 403
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test test.js
```

Expected: FAIL — `Cannot find module './src/services/fileService'`

- [ ] **Step 3: Create `src/services/fileService.js`**

Create the file with this full content:

```js
'use strict';

const path = require('path');
const fsp  = require('fs/promises');
const fs   = require('fs');

const { badRequest, notFound, conflict, forbidden } = require('../utils/errors');

const SERVERS_ROOT = process.env.YAMS_SERVERS_ROOT
  || path.join(__dirname, '..', '..', 'servers');

const FILE_UPLOAD_LIMIT = process.env.FILE_UPLOAD_LIMIT
  ? parseInt(process.env.FILE_UPLOAD_LIMIT, 10)
  : 524_288_000; // 500 MB

const FILE_LIST_LIMIT = process.env.FILE_LIST_LIMIT
  ? parseInt(process.env.FILE_LIST_LIMIT, 10)
  : 1000;

// ─── Inline MIME map ─────────────────────────────────────────────────────────
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

// ─── Path Security ───────────────────────────────────────────────────────────

function resolveSafePath(serverId, userPath = '') {
  const serverRoot = path.resolve(SERVERS_ROOT, serverId);
  const resolved   = path.resolve(serverRoot, userPath);

  if (resolved !== serverRoot && !resolved.startsWith(serverRoot + path.sep)) {
    throw forbidden('Path escapes server root');
  }
  return { resolved, serverRoot };
}

async function rejectSymlink(resolvedPath) {
  let stat;
  try {
    stat = await fsp.lstat(resolvedPath);
  } catch {
    throw notFound(`Path not found`);
  }
  if (stat.isSymbolicLink()) throw forbidden('Symlinks are not permitted');
  return stat;
}

// ─── listDirectory ───────────────────────────────────────────────────────────

async function listDirectory(serverId, dirPath = '') {
  const { resolved } = resolveSafePath(serverId, dirPath);

  let entries;
  try {
    entries = await fsp.readdir(resolved, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOTDIR') throw badRequest('Path is not a directory');
    if (err.code === 'ENOENT')  throw notFound('Directory not found');
    throw err;
  }

  const truncated = entries.length > FILE_LIST_LIMIT;
  const slice     = entries.slice(0, FILE_LIST_LIMIT);

  const data = await Promise.all(
    slice
      .filter(e => !e.isSymbolicLink())  // silently skip symlinks
      .map(async (e) => {
        const stat = await fsp.stat(path.join(resolved, e.name)).catch(() => null);
        if (e.isDirectory()) {
          return { name: e.name, type: 'directory', modified: stat ? stat.mtimeMs : null };
        }
        return { name: e.name, type: 'file', size: stat ? stat.size : null, modified: stat ? stat.mtimeMs : null };
      })
  );

  return { data, truncated };
}

module.exports = { listDirectory, FILE_UPLOAD_LIMIT, FILE_LIST_LIMIT };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test test.js
```

Expected: 5 tests PASS (2 from Task 1 + 3 from Task 2)

- [ ] **Step 5: Commit**

```bash
git add src/services/fileService.js test.js
git commit -m "feat: add fileService with path security and listDirectory"
```

---

### Task 3: Add `downloadFile` to `fileService.js`

**Files:**
- Modify: `src/services/fileService.js`
- Test: `test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test.js`:

```js
// ─── downloadFile ─────────────────────────────────────────────────────────────
test('downloadFile returns a readable stream and metadata', async () => {
  const { downloadFile } = require('./src/services/fileService');
  const dir = await setupServerDir();

  await fsp.writeFile(path.join(dir, 'eula.txt'), 'eula=true');

  const result = await downloadFile(TEST_SERVER_ID, 'eula.txt');
  assert.ok(result.stream,                        'should return a stream');
  assert.equal(result.filename, 'eula.txt');
  assert.ok(typeof result.contentType === 'string');
  assert.ok(typeof result.size === 'number');

  const chunks = [];
  await new Promise((resolve, reject) => {
    result.stream.on('data', c => chunks.push(c));
    result.stream.on('end', resolve);
    result.stream.on('error', reject);
  });
  assert.equal(Buffer.concat(chunks).toString(), 'eula=true');
});

test('downloadFile rejects a directory with 400', async () => {
  const { downloadFile } = require('./src/services/fileService');
  const dir = await setupServerDir();
  await fsp.mkdir(path.join(dir, 'plugins'), { recursive: true });

  await assert.rejects(
    () => downloadFile(TEST_SERVER_ID, 'plugins'),
    (err) => err.statusCode === 400
  );
});

test('downloadFile rejects path traversal with 403', async () => {
  const { downloadFile } = require('./src/services/fileService');
  await setupServerDir();

  await assert.rejects(
    () => downloadFile(TEST_SERVER_ID, '../../../etc/passwd'),
    (err) => err.statusCode === 403
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test test.js
```

Expected: FAIL — `downloadFile is not a function`

- [ ] **Step 3: Add `downloadFile` to `src/services/fileService.js`**

Add this function before `module.exports`:

```js
// ─── downloadFile ─────────────────────────────────────────────────────────────

async function downloadFile(serverId, filePath) {
  const { resolved } = resolveSafePath(serverId, filePath);
  const stat = await rejectSymlink(resolved);

  if (stat.isDirectory()) throw badRequest('Cannot download a directory');

  const ext         = path.extname(resolved).toLowerCase();
  const contentType = MIME[ext] || DEFAULT_MIME;
  const filename    = path.basename(resolved);
  const stream      = fs.createReadStream(resolved);

  return { stream, filename, contentType, size: stat.size };
}
```

Update `module.exports`:

```js
module.exports = { listDirectory, downloadFile, FILE_UPLOAD_LIMIT, FILE_LIST_LIMIT };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test test.js
```

Expected: 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/fileService.js test.js
git commit -m "feat: add downloadFile with streaming and MIME detection"
```

---

### Task 4: Install `busboy` + add `uploadFile` to `fileService.js`

**Files:**
- Modify: `src/services/fileService.js`
- Test: `test.js`

- [ ] **Step 1: Install busboy**

```bash
npm install busboy
```

Expected: busboy added to `package.json` dependencies and `node_modules/busboy/` present.

- [ ] **Step 2: Write the failing tests**

Append to `test.js`:

```js
// ─── uploadFile ───────────────────────────────────────────────────────────────
const { Readable } = require('node:stream');

function buildMultipart(filename, content) {
  const boundary = '----TestBoundary7777';
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`
    ),
    Buffer.isBuffer(content) ? content : Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, boundary };
}

function fakeReq(body, boundary) {
  const stream = Readable.from([body]);
  stream.headers = {
    'content-type':   `multipart/form-data; boundary=${boundary}`,
    'content-length': String(body.length),
  };
  return stream;
}

test('uploadFile saves a file to the server directory', async () => {
  const { uploadFile } = require('./src/services/fileService');
  const dir = await setupServerDir();

  const { body, boundary } = buildMultipart('uploaded.txt', 'hello world');
  await uploadFile(TEST_SERVER_ID, '', fakeReq(body, boundary), false);

  const content = await fsp.readFile(path.join(dir, 'uploaded.txt'), 'utf8');
  assert.equal(content, 'hello world');
});

test('uploadFile returns 409 if file exists and overwrite=false', async () => {
  const { uploadFile } = require('./src/services/fileService');
  const dir = await setupServerDir();
  await fsp.writeFile(path.join(dir, 'existing.txt'), 'original');

  const { body, boundary } = buildMultipart('existing.txt', 'new content');
  await assert.rejects(
    () => uploadFile(TEST_SERVER_ID, '', fakeReq(body, boundary), false),
    (err) => err.statusCode === 409
  );

  const content = await fsp.readFile(path.join(dir, 'existing.txt'), 'utf8');
  assert.equal(content, 'original', 'Original file must be untouched');
});

test('uploadFile overwrites if overwrite=true', async () => {
  const { uploadFile } = require('./src/services/fileService');
  const dir = await setupServerDir();
  await fsp.writeFile(path.join(dir, 'replace-me.txt'), 'original');

  const { body, boundary } = buildMultipart('replace-me.txt', 'replaced');
  await uploadFile(TEST_SERVER_ID, '', fakeReq(body, boundary), true);

  const content = await fsp.readFile(path.join(dir, 'replace-me.txt'), 'utf8');
  assert.equal(content, 'replaced');
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
node --test test.js
```

Expected: FAIL — `uploadFile is not a function`

- [ ] **Step 4: Add `uploadFile` to `src/services/fileService.js`**

At the very top of the file, add:

```js
const busboy = require('busboy');
```

Add this function before `module.exports`:

```js
// ─── uploadFile ───────────────────────────────────────────────────────────────

async function uploadFile(serverId, destDir, req, overwrite) {
  const { resolved: destResolved } = resolveSafePath(serverId, destDir);

  return new Promise((resolve, reject) => {
    let tmpPath          = null;
    let finalPath        = null;
    let writeError       = null;
    let overwriteBlocked = false;
    let sizeExceeded     = false;

    const bb = busboy({
      headers: req.headers,
      limits: { files: 1, fileSize: FILE_UPLOAD_LIMIT },
    });

    bb.on('file', async (fieldname, stream, info) => {
      try {
        const filename = path.basename(info.filename || '');
        if (!filename) {
          stream.resume();
          return reject(badRequest('Uploaded file has no name'));
        }

        const { resolved: fp } = resolveSafePath(serverId, path.join(destDir, filename));
        finalPath = fp;
        tmpPath   = finalPath + '.yams_tmp';

        // Check overwrite BEFORE consuming the stream (fail fast)
        const exists = await fsp.access(finalPath).then(() => true).catch(() => false);
        if (exists && !overwrite) {
          overwriteBlocked = true;
          stream.resume(); // drain without writing
          return;
        }

        const ws = fs.createWriteStream(tmpPath);

        stream.on('limit', () => {
          sizeExceeded = true;
          stream.destroy();
          ws.destroy();
        });

        stream.pipe(ws);
        ws.on('error', (err) => { writeError = err; });
      } catch (err) {
        stream.resume();
        reject(err);
      }
    });

    bb.on('close', async () => {
      try {
        if (sizeExceeded) {
          if (tmpPath) await fsp.unlink(tmpPath).catch(() => {});
          return reject(badRequest(`File exceeds the ${FILE_UPLOAD_LIMIT}-byte upload limit`));
        }
        if (overwriteBlocked) {
          return reject(conflict('File already exists. Send overwrite=true to replace it'));
        }
        if (writeError) {
          if (tmpPath) await fsp.unlink(tmpPath).catch(() => {});
          return reject(writeError);
        }
        if (!finalPath) {
          return reject(badRequest('No file was provided in the request'));
        }
        await fsp.rename(tmpPath, finalPath);
        resolve({ name: path.basename(finalPath) });
      } catch (err) {
        reject(err);
      }
    });

    bb.on('error', reject);
    req.pipe(bb);
  });
}
```

Update `module.exports`:

```js
module.exports = { listDirectory, downloadFile, uploadFile, FILE_UPLOAD_LIMIT, FILE_LIST_LIMIT };
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
node --test test.js
```

Expected: 11 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/fileService.js test.js package.json package-lock.json
git commit -m "feat: add uploadFile with busboy streaming and atomic write"
```

---

### Task 5: Add `createFolder`, `renameFile`, `deleteFile` to `fileService.js`

**Files:**
- Modify: `src/services/fileService.js`
- Test: `test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test.js`:

```js
// ─── createFolder ─────────────────────────────────────────────────────────────
test('createFolder creates a nested directory', async () => {
  const { createFolder } = require('./src/services/fileService');
  const dir = await setupServerDir();

  await createFolder(TEST_SERVER_ID, 'plugins/myplugin');

  const stat = await fsp.stat(path.join(dir, 'plugins', 'myplugin'));
  assert.ok(stat.isDirectory());
});

test('createFolder is idempotent when directory already exists', async () => {
  const { createFolder } = require('./src/services/fileService');
  const dir = await setupServerDir();
  await fsp.mkdir(path.join(dir, 'already'), { recursive: true });

  // Must not throw
  await createFolder(TEST_SERVER_ID, 'already');
});

test('createFolder rejects path traversal with 403', async () => {
  const { createFolder } = require('./src/services/fileService');
  await setupServerDir();

  await assert.rejects(
    () => createFolder(TEST_SERVER_ID, '../escape'),
    (err) => err.statusCode === 403
  );
});

// ─── renameFile ───────────────────────────────────────────────────────────────
test('renameFile moves a file within the server root', async () => {
  const { renameFile } = require('./src/services/fileService');
  const dir = await setupServerDir();
  await fsp.writeFile(path.join(dir, 'src-rename.txt'), 'data');

  await renameFile(TEST_SERVER_ID, 'src-rename.txt', 'dst-rename.txt');

  await assert.rejects(() => fsp.access(path.join(dir, 'src-rename.txt')));
  const content = await fsp.readFile(path.join(dir, 'dst-rename.txt'), 'utf8');
  assert.equal(content, 'data');
});

test('renameFile rejects traversal in `from` with 403', async () => {
  const { renameFile } = require('./src/services/fileService');
  await setupServerDir();

  await assert.rejects(
    () => renameFile(TEST_SERVER_ID, '../../etc/passwd', 'safe.txt'),
    (err) => err.statusCode === 403
  );
});

test('renameFile rejects renaming server root with 403', async () => {
  const { renameFile } = require('./src/services/fileService');
  await setupServerDir();

  await assert.rejects(
    () => renameFile(TEST_SERVER_ID, '', 'new-name'),
    (err) => err.statusCode === 403
  );
});

// ─── deleteFile ───────────────────────────────────────────────────────────────
test('deleteFile removes a file', async () => {
  const { deleteFile } = require('./src/services/fileService');
  const dir = await setupServerDir();
  await fsp.writeFile(path.join(dir, 'delete-me.txt'), 'bye');

  await deleteFile(TEST_SERVER_ID, 'delete-me.txt');

  await assert.rejects(() => fsp.access(path.join(dir, 'delete-me.txt')));
});

test('deleteFile removes a directory recursively', async () => {
  const { deleteFile } = require('./src/services/fileService');
  const dir = await setupServerDir();
  await fsp.mkdir(path.join(dir, 'old-world', 'region'), { recursive: true });
  await fsp.writeFile(path.join(dir, 'old-world', 'region', 'r.0.0.mca'), '');

  await deleteFile(TEST_SERVER_ID, 'old-world');

  await assert.rejects(() => fsp.access(path.join(dir, 'old-world')));
});

test('deleteFile rejects deletion of server root via empty string with 403', async () => {
  const { deleteFile } = require('./src/services/fileService');
  await setupServerDir();

  await assert.rejects(
    () => deleteFile(TEST_SERVER_ID, ''),
    (err) => err.statusCode === 403
  );
});

test('deleteFile rejects path traversal with 403', async () => {
  const { deleteFile } = require('./src/services/fileService');
  await setupServerDir();

  await assert.rejects(
    () => deleteFile(TEST_SERVER_ID, '../other-server'),
    (err) => err.statusCode === 403
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test test.js
```

Expected: FAIL — `createFolder is not a function`

- [ ] **Step 3: Add `createFolder`, `renameFile`, `deleteFile` to `src/services/fileService.js`**

Add these three functions before `module.exports`:

```js
// ─── createFolder ─────────────────────────────────────────────────────────────

async function createFolder(serverId, dirPath) {
  const { resolved } = resolveSafePath(serverId, dirPath);
  await fsp.mkdir(resolved, { recursive: true });
}

// ─── renameFile ───────────────────────────────────────────────────────────────

async function renameFile(serverId, fromPath, toPath) {
  const { resolved: from, serverRoot } = resolveSafePath(serverId, fromPath);
  const { resolved: to }               = resolveSafePath(serverId, toPath);

  if (from === serverRoot) throw forbidden('Cannot rename the server root directory');

  await rejectSymlink(from);
  await fsp.rename(from, to);
}

// ─── deleteFile ───────────────────────────────────────────────────────────────

async function deleteFile(serverId, filePath) {
  const { resolved, serverRoot } = resolveSafePath(serverId, filePath);

  if (resolved === serverRoot) throw forbidden('Cannot delete the server root directory');

  const stat = await rejectSymlink(resolved);

  if (stat.isDirectory()) {
    await fsp.rm(resolved, { recursive: true, force: true });
  } else {
    await fsp.unlink(resolved);
  }
}
```

Update `module.exports`:

```js
module.exports = {
  listDirectory,
  downloadFile,
  uploadFile,
  createFolder,
  renameFile,
  deleteFile,
  FILE_UPLOAD_LIMIT,
  FILE_LIST_LIMIT,
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test test.js
```

Expected: 21 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/fileService.js test.js
git commit -m "feat: add createFolder, renameFile, deleteFile to fileService"
```

---

### Task 6: Create `fileController.js`

**Files:**
- Create: `src/controllers/fileController.js`

No separate unit tests — controller correctness is verified at the route/smoke test level in Task 7 and security level in Task 8.

- [ ] **Step 1: Create `src/controllers/fileController.js`** with this full content:

```js
'use strict';

const serverModel = require('../models/serverModel');
const fileService = require('../services/fileService');
const { notFound, badRequest } = require('../utils/errors');

function requireServer(id) {
  const server = serverModel.findById(id);
  if (!server) throw notFound(`Server '${id}' not found`);
  return server;
}

/** GET /servers/:id/files?path= */
async function list(req, res, next) {
  try {
    requireServer(req.params.id);
    const result = await fileService.listDirectory(req.params.id, req.query.path || '');
    res.json(result);
  } catch (err) { next(err); }
}

/** GET /servers/:id/files/download?path= */
async function download(req, res, next) {
  try {
    requireServer(req.params.id);
    const { stream, filename, contentType, size } = await fileService.downloadFile(
      req.params.id,
      req.query.path || ''
    );
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    if (size != null) res.setHeader('Content-Length', size);
    stream.pipe(res);
    stream.on('error', next);
  } catch (err) { next(err); }
}

/** POST /servers/:id/files/upload?path=&overwrite= */
async function upload(req, res, next) {
  try {
    requireServer(req.params.id);
    const overwrite = req.query.overwrite === 'true';
    const result = await fileService.uploadFile(
      req.params.id,
      req.query.path || '',
      req,
      overwrite
    );
    res.status(201).json({ data: result });
  } catch (err) { next(err); }
}

/** POST /servers/:id/files/mkdir */
async function mkdir(req, res, next) {
  try {
    requireServer(req.params.id);
    if (!req.body.path) return next(badRequest('path is required'));
    await fileService.createFolder(req.params.id, req.body.path);
    res.json({ data: { path: req.body.path } });
  } catch (err) { next(err); }
}

/** PUT /servers/:id/files/rename */
async function rename(req, res, next) {
  try {
    requireServer(req.params.id);
    const { from, to } = req.body;
    if (!from || !to) return next(badRequest('Both from and to are required'));
    await fileService.renameFile(req.params.id, from, to);
    res.json({ data: { from, to } });
  } catch (err) { next(err); }
}

/** DELETE /servers/:id/files */
async function remove(req, res, next) {
  try {
    requireServer(req.params.id);
    if (req.body.path === undefined || req.body.path === null) {
      return next(badRequest('path is required'));
    }
    await fileService.deleteFile(req.params.id, req.body.path);
    res.json({ data: { deleted: req.body.path } });
  } catch (err) { next(err); }
}

module.exports = { list, download, upload, mkdir, rename, remove };
```

- [ ] **Step 2: Commit**

```bash
git add src/controllers/fileController.js
git commit -m "feat: add fileController with all 6 HTTP handlers"
```

---

### Task 7: Create `fileRoutes.js` and mount in `app.js`

**Files:**
- Create: `src/routes/fileRoutes.js`
- Modify: `app.js`

- [ ] **Step 1: Create `src/routes/fileRoutes.js`** with this full content:

```js
'use strict';

const { Router } = require('express');
const controller  = require('../controllers/fileController');

// mergeParams: true is REQUIRED — without it req.params.id is undefined
// because :id is defined in the parent app.use('/servers/:id/files', ...)
const router = Router({ mergeParams: true });

router.get('/',         controller.list);      // GET    /servers/:id/files?path=
router.get('/download', controller.download);  // GET    /servers/:id/files/download?path=
router.post('/upload',  controller.upload);    // POST   /servers/:id/files/upload?path=&overwrite=
router.post('/mkdir',   controller.mkdir);     // POST   /servers/:id/files/mkdir
router.put('/rename',   controller.rename);    // PUT    /servers/:id/files/rename
router.delete('/',      controller.remove);    // DELETE /servers/:id/files

module.exports = router;
```

- [ ] **Step 2: Modify `app.js` — add require**

After the line `const serverRoutes = require('./src/routes/serverRoutes');`, add:

```js
const fileRoutes   = require('./src/routes/fileRoutes');
```

- [ ] **Step 3: Modify `app.js` — mount the router**

After the line `app.use('/servers', serverRoutes);`, add:

```js
app.use('/servers/:id/files', fileRoutes);
```

- [ ] **Step 4: Modify `app.js` — update startup banner**

Inside the `app.listen` callback, after the existing `console.log` lines listing endpoints, add:

```js
  console.log('  GET    /servers/:id/files');
  console.log('  GET    /servers/:id/files/download?path=');
  console.log('  POST   /servers/:id/files/upload');
  console.log('  POST   /servers/:id/files/mkdir');
  console.log('  PUT    /servers/:id/files/rename');
  console.log('  DELETE /servers/:id/files');
```

- [ ] **Step 5: Smoke test**

Start the server:

```bash
node app.js
```

In a second terminal, list files for any valid server ID in your DB (replace `<ID>`):

```bash
curl http://localhost:3000/servers/<ID>/files
```

Expected: `{"data":[...],"truncated":false}`

Test traversal rejection:

```bash
curl "http://localhost:3000/servers/<ID>/files?path=../../etc"
```

Expected: HTTP 403 — `{"error":"Path escapes server root"}`

Test 404 on unknown server:

```bash
curl http://localhost:3000/servers/00000000-fake/files
```

Expected: HTTP 404 — `{"error":"Server '00000000-fake' not found"}`

Stop the server with Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add src/routes/fileRoutes.js app.js
git commit -m "feat: add fileRoutes and mount under /servers/:id/files"
```

---

### Task 8: Security integration tests

**Files:**
- Test: `test.js`

- [ ] **Step 1: Write the security tests**

Append to `test.js`:

```js
// ─── Security: path traversal ─────────────────────────────────────────────────
test('security: listDirectory blocks all traversal payloads', async () => {
  const { listDirectory } = require('./src/services/fileService');
  await setupServerDir();

  const payloads = [
    '../',
    '../../',
    '../../../etc',
    'subdir/../../../../etc',
    '/etc/passwd',
    '/etc',
  ];

  for (const p of payloads) {
    await assert.rejects(
      () => listDirectory(TEST_SERVER_ID, p),
      (err) => err.statusCode === 403,
      `Expected 403 for payload: ${JSON.stringify(p)}`
    );
  }
});

test('security: cannot access another server via path traversal', async () => {
  const { listDirectory } = require('./src/services/fileService');

  const SERVER_A = 'server-alpha';
  const SERVER_B = 'server-beta';
  await fsp.mkdir(path.join(TEST_ROOT, SERVER_A), { recursive: true });
  await fsp.mkdir(path.join(TEST_ROOT, SERVER_B), { recursive: true });
  await fsp.writeFile(path.join(TEST_ROOT, SERVER_B, 'secret.txt'), 'secret');

  await assert.rejects(
    () => listDirectory(SERVER_A, '../server-beta'),
    (err) => err.statusCode === 403
  );
});

// ─── Security: symlink rejection ──────────────────────────────────────────────
test('security: symlink in download path is rejected with 403', async () => {
  const { downloadFile } = require('./src/services/fileService');
  const dir = await setupServerDir();

  await fsp.writeFile(path.join(dir, 'real.txt'), 'real content');
  try {
    await fsp.symlink(path.join(dir, 'real.txt'), path.join(dir, 'link.txt'));
  } catch {
    // Symlinks not supported in this environment — skip
    return;
  }

  await assert.rejects(
    () => downloadFile(TEST_SERVER_ID, 'link.txt'),
    (err) => err.statusCode === 403
  );
});

test('security: symlink in delete path is rejected with 403', async () => {
  const { deleteFile } = require('./src/services/fileService');
  const dir = await setupServerDir();

  await fsp.writeFile(path.join(dir, 'real-del.txt'), 'real');
  try {
    await fsp.symlink(path.join(dir, 'real-del.txt'), path.join(dir, 'link-del.txt'));
  } catch {
    return;
  }

  await assert.rejects(
    () => deleteFile(TEST_SERVER_ID, 'link-del.txt'),
    (err) => err.statusCode === 403
  );
});

// ─── Security: root deletion ──────────────────────────────────────────────────
test('security: deleteFile rejects server root via empty string', async () => {
  const { deleteFile } = require('./src/services/fileService');
  await setupServerDir();

  await assert.rejects(
    () => deleteFile(TEST_SERVER_ID, ''),
    (err) => err.statusCode === 403
  );
});

test('security: deleteFile rejects server root via dot', async () => {
  const { deleteFile } = require('./src/services/fileService');
  await setupServerDir();

  await assert.rejects(
    () => deleteFile(TEST_SERVER_ID, '.'),
    (err) => err.statusCode === 403
  );
});

test('security: renameFile rejects server root via empty string', async () => {
  const { renameFile } = require('./src/services/fileService');
  await setupServerDir();

  await assert.rejects(
    () => renameFile(TEST_SERVER_ID, '', 'new-name'),
    (err) => err.statusCode === 403
  );
});
```

- [ ] **Step 2: Run all tests**

```bash
node --test test.js
```

Expected: all 28 tests PASS with no failures

- [ ] **Step 3: Commit**

```bash
git add test.js
git commit -m "test: add security integration tests for file manager"
```

---

## Self-Review

### Spec coverage

| Requirement | Task |
|---|---|
| `resolveSafePath` internal function | Task 2 |
| `GET /files?path=` — list directory | Task 2 |
| `GET /files/download?path=` — stream file | Task 3 |
| `POST /files/upload` — busboy streaming | Task 4 |
| Atomic write (temp → rename) | Task 4 |
| 500 MB default limit (`FILE_UPLOAD_LIMIT`) | Task 4 |
| 409 on existing file without `overwrite=true` | Task 4 |
| `POST /files/mkdir` — create folder | Task 5 |
| `PUT /files/rename` — move/rename | Task 5 |
| `DELETE /files` — delete file or directory | Task 5 |
| Forbidden root delete | Task 5 + Task 8 |
| Forbidden root rename | Task 5 + Task 8 |
| `forbidden()` factory (403) | Task 1 |
| Controller thin layer | Task 6 |
| `mergeParams: true` on Router | Task 7 |
| Mount in `app.js` | Task 7 |
| Path traversal blocked | Task 2 tests + Task 8 |
| Symlinks rejected | Task 8 |
| Cross-server access blocked | Task 8 |
| Max 1000 entries + `truncated` flag | Task 2 (implementation) |
| Symlinks silently skipped in listings | Task 2 (implementation) |
| Content-Disposition + Content-Type headers | Task 3 (implementation) + Task 6 |

All requirements covered. No gaps.

### Placeholder scan

No TBDs, no "add error handling", no forward references to functions not yet defined.

### Type consistency

- `listDirectory` → `{ data, truncated }` — controller does `res.json(result)` (passes through) ✓
- `downloadFile` → `{ stream, filename, contentType, size }` — controller destructures the same 4 fields ✓
- `uploadFile` → `{ name }` — controller wraps as `{ data: result }` ✓
- `createFolder` → void — controller returns `{ data: { path } }` ✓
- `renameFile` → void — controller returns `{ data: { from, to } }` ✓
- `deleteFile` → void — controller returns `{ data: { deleted } }` ✓
- `deleteFile(TEST_SERVER_ID, '.')` → `path.resolve(serverRoot, '.')` === `serverRoot` → root guard fires ✓
