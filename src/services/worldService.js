'use strict';

const fs       = require('fs');
const fsp      = require('fs/promises');
const path     = require('path');
const { Transform }            = require('stream');
const { AsyncLocalStorage }    = require('node:async_hooks');
const { v4: uuidv4 }           = require('uuid');
const archiver                 = require('archiver');
const unzipper                 = require('unzipper');
const busboy                   = require('busboy');

const { badRequest, notFound, conflict, tooLarge, internal } = require('../utils/errors');

const SERVERS_ROOT = process.env.YAMS_SERVERS_ROOT
  || path.join(__dirname, '..', '..', 'servers');

// ─── Constants ───────────────────────────────────────────────────────────────

const WORLD_BLACKLIST = new Set([
  'backups', 'logs', 'crash-reports', 'plugins', 'mods', 'config',
  'libraries', 'versions', 'assets', 'data', 'cache', 'dynmap',
  'BlueMap', 'LuckPerms',
]);

const MARKER_FILE    = 'level.dat';
const MARKER_DIRS    = ['region', 'data', 'DIM-1', 'DIM1'];
const ALL_MARKERS    = new Set([MARKER_FILE, ...MARKER_DIRS]);
const IMPORT_ALLOWED = new Set([MARKER_FILE, ...MARKER_DIRS]);

const IMPORT_MAX_BYTES        = (Number(process.env.WORLD_IMPORT_MAX_SIZE_MB) || 2048) * 1024 * 1024;
const IMPORT_MAX_UNCOMPRESSED = (Number(process.env.WORLD_IMPORT_MAX_UNCOMPRESSED_MB) || 500) * 1024 * 1024;
const IMPORT_MAX_FILE_COUNT   = Number(process.env.WORLD_IMPORT_MAX_FILES) || 10_000;
const SIZE_CACHE_TTL          = Number(process.env.WORLD_SIZE_CACHE_TTL_MS) || 60_000;
const SIZE_TIMEOUT_MS         = 30_000;
const SIZE_INFLIGHT_MAX       = Number(process.env.WORLD_SIZE_INFLIGHT_MAX) || 10;
const MUTEX_QUEUE_MAX         = Number(process.env.WORLD_MUTEX_QUEUE_MAX) || 50;
const GLOBAL_MUTEX_MAX        = Number(process.env.WORLD_GLOBAL_MUTEX_MAX) || 200;

// O_NOFOLLOW: reject if last path component is a symlink (Linux/macOS; 0 on Windows — no-op).
const O_NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;

// Flags for writing new files during zip extraction: create, write-only, fail if exists, no symlink follow.
const WRITE_FLAGS = fs.constants.O_CREAT | fs.constants.O_WRONLY | fs.constants.O_EXCL | O_NOFOLLOW;

// Extensions that must never appear inside an imported zip.
const DANGEROUS_EXTENSIONS = new Set([
  '.sh', '.bash', '.zsh', '.exe', '.jar', '.bat',
  '.cmd', '.com', '.ps1', '.py', '.rb', '.php', '.pl',
]);

// ─── In-memory state ─────────────────────────────────────────────────────────

const mutexMap     = new Map(); // serverId → Promise (FIFO tail)
const mutexDepth   = new Map(); // serverId → pending+running count
let   globalMutexDepth = 0;    // total ops in flight across all servers
const sizeCache    = new Map(); // worldPath → { size, computedAt }
const inFlightSize = new Map(); // worldPath → Promise<void>

// ─── Request context (propagated via AsyncLocalStorage) ───────────────────────

const reqCtx = new AsyncLocalStorage();

// ─── Structured logging ───────────────────────────────────────────────────────

function log(level, event, data = {}) {
  const ctx = reqCtx.getStore() ?? {};
  const record = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...(ctx.requestId !== undefined && { requestId: ctx.requestId }),
    ...(ctx.ip        !== undefined && { ip:        ctx.ip }),
    ...(ctx.userId    !== undefined && { userId:    ctx.userId }),
    ...data,
  });
  (level === 'error' ? console.error : console.log)('[YAMS:worlds]', record);
}

// ─── Mutex — FIFO with per-server and global queue depth caps ────────────────

function withMutex(serverId, fn) {
  const depth = mutexDepth.get(serverId) ?? 0;
  if (depth >= MUTEX_QUEUE_MAX) {
    throw conflict('Too many concurrent operations for this server', 'MUTEX_QUEUE_FULL');
  }
  if (globalMutexDepth >= GLOBAL_MUTEX_MAX) {
    throw conflict('Server is too busy — please retry later', 'GLOBAL_MUTEX_QUEUE_FULL');
  }

  mutexDepth.set(serverId, depth + 1);
  globalMutexDepth++;

  const prev = mutexMap.get(serverId) ?? Promise.resolve();
  const next = prev.then(() => fn()).finally(() => {
    const cur = mutexDepth.get(serverId) ?? 1;
    if (cur <= 1) mutexDepth.delete(serverId);
    else mutexDepth.set(serverId, cur - 1);
    globalMutexDepth = Math.max(0, globalMutexDepth - 1);
    if (mutexMap.get(serverId) === next) mutexMap.delete(serverId);
  });
  mutexMap.set(serverId, next);
  return next;
}

// ─── Name validation ─────────────────────────────────────────────────────────

const NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function validateName(name) {
  if (
    typeof name !== 'string' ||
    !NAME_RE.test(name) ||
    name === '.' || name === '..' ||
    WORLD_BLACKLIST.has(name) ||
    name.includes('/') || name.includes('\\')
  ) {
    throw badRequest('Invalid world name', 'INVALID_WORLD_NAME');
  }
}

// ─── Path helpers ─────────────────────────────────────────────────────────────

function validateServerPath(serverPath) {
  const root     = path.resolve(SERVERS_ROOT);
  const resolved = path.resolve(serverPath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw internal('Server path is outside the servers root');
  }
}

function resolveWorldPath(serverPath, name) {
  const resolved = path.resolve(serverPath, name);
  if (resolved === serverPath || !resolved.startsWith(serverPath + path.sep)) {
    throw badRequest('Invalid world name', 'INVALID_WORLD_NAME');
  }
  return resolved;
}

async function checkNotSymlink(worldPath) {
  try {
    const st = await fsp.lstat(worldPath);
    if (st.isSymbolicLink()) throw badRequest('Symlink worlds are not allowed', 'SYMLINK_FORBIDDEN');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
}

// ─── World marker detection ───────────────────────────────────────────────────

async function hasWorldMarkers(worldPath) {
  const checks = await Promise.allSettled([
    fsp.stat(path.join(worldPath, MARKER_FILE)).then(s => s.isFile()),
    ...MARKER_DIRS.map(d => fsp.stat(path.join(worldPath, d)).then(s => s.isDirectory())),
  ]);
  return checks.some(r => r.status === 'fulfilled' && r.value === true);
}

async function isValidWorld(serverPath, name) {
  if (WORLD_BLACKLIST.has(name)) return false;
  const worldPath = path.join(serverPath, name);
  let lst;
  try {
    lst = await fsp.lstat(worldPath);
  } catch {
    return false;
  }
  if (!lst.isDirectory() || lst.isSymbolicLink()) return false;
  return hasWorldMarkers(worldPath);
}

// ─── server.properties ───────────────────────────────────────────────────────

function extractKey(rawLine, targetKey) {
  const line = rawLine.replace(/\r$/, '');
  if (!line.includes('=') || line.trimStart().startsWith('#')) return null;
  const eqIdx = line.indexOf('=');
  if (line.slice(0, eqIdx).trim() !== targetKey) return null;
  return line.slice(eqIdx + 1); // raw value — no trim, no normalization
}

async function readLevelName(serverPath) {
  const propsPath = path.join(serverPath, 'server.properties');
  let fh = null;
  try {
    fh = await fsp.open(propsPath, fs.constants.O_RDONLY | O_NOFOLLOW);
    const content = await fh.readFile('utf8');
    for (const line of content.split('\n')) {
      const val = extractKey(line, 'level-name');
      if (val !== null) return val;
    }
    return 'world';
  } catch (err) {
    // ENOENT: file absent; ELOOP: server.properties is a symlink — treat as absent.
    if (err.code === 'ENOENT' || err.code === 'ELOOP') return 'world';
    throw err;
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

async function writeLevelName(serverPath, newName) {
  const propsPath = path.join(serverPath, 'server.properties');
  const tmpPath   = `${propsPath}.tmp`;

  let lines = [];
  let fh = null;
  try {
    fh = await fsp.open(propsPath, fs.constants.O_RDONLY | O_NOFOLLOW);
    lines = (await fh.readFile('utf8')).split('\n');
  } catch (err) {
    if (err.code !== 'ENOENT' && err.code !== 'ELOOP') throw err;
  } finally {
    if (fh) await fh.close().catch(() => {});
  }

  let found = false;
  const out = lines.map(line => {
    if (found) return line;
    const val = extractKey(line, 'level-name');
    if (val !== null) { found = true; return `level-name=${newName}`; }
    return line;
  });
  if (!found) out.push(`level-name=${newName}`);

  // O_EXCL + O_NOFOLLOW: create the tmp file exclusively — fails if it already exists
  // or if tmpPath is a symlink, preventing TOCTOU attacks on the write path.
  const wFlags = fs.constants.O_CREAT | fs.constants.O_WRONLY | fs.constants.O_EXCL | O_NOFOLLOW;
  let wh = null;
  try {
    try {
      wh = await fsp.open(tmpPath, wFlags, 0o600);
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      // Stale tmp from a previously crashed write — remove and retry once.
      await fsp.unlink(tmpPath).catch(() => {});
      wh = await fsp.open(tmpPath, wFlags, 0o600);
    }
    await wh.writeFile(out.join('\n'), 'utf8');
  } finally {
    if (wh) await wh.close().catch(() => {});
  }

  try {
    await fsp.rename(tmpPath, propsPath);
  } catch (err) {
    await fsp.unlink(tmpPath).catch(() => {});
    throw err;
  }
}

// ─── Size computation ─────────────────────────────────────────────────────────

async function _computeSizeRaw(worldPath) {
  let total = 0;
  const queue = [worldPath];
  const deadline = Date.now() + SIZE_TIMEOUT_MS;

  while (queue.length > 0) {
    if (Date.now() > deadline) return null;
    const dir = queue.shift();
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch { continue; }

    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        queue.push(p);
      } else if (e.isFile()) {
        try { total += (await fsp.stat(p)).size; } catch { /* EACCES/ENOENT — skip */ }
      }
    }
  }
  return total;
}

function _launchSizeCompute(worldPath) {
  if (inFlightSize.has(worldPath)) return;
  if (inFlightSize.size >= SIZE_INFLIGHT_MAX) return;

  const p = _computeSizeRaw(worldPath)
    .then(size => { sizeCache.set(worldPath, { size, computedAt: Date.now() }); })
    .catch(()   => { sizeCache.set(worldPath, { size: null, computedAt: Date.now() }); })
    .finally(() => { inFlightSize.delete(worldPath); });

  inFlightSize.set(worldPath, p);
}

function getCachedSize(worldPath) {
  const entry = sizeCache.get(worldPath);
  if (entry && Date.now() - entry.computedAt < SIZE_CACHE_TTL) return entry.size;
  _launchSizeCompute(worldPath);
  return null;
}

async function computeSizeSync(worldPath) {
  const entry = sizeCache.get(worldPath);
  if (entry && Date.now() - entry.computedAt < SIZE_CACHE_TTL) return entry.size;
  const size = await _computeSizeRaw(worldPath);
  sizeCache.set(worldPath, { size, computedAt: Date.now() });
  return size;
}

// ─── World object builder ─────────────────────────────────────────────────────

async function buildWorld(serverPath, name, levelName) {
  const worldPath = resolveWorldPath(serverPath, name);
  let updatedAt = null;
  try {
    updatedAt = (await fsp.stat(worldPath)).mtime.toISOString();
  } catch { /* inaccessible — return null */ }
  return {
    name,
    active: name === levelName,
    size: getCachedSize(worldPath),
    updatedAt,
  };
}

// ─── ZIP entry validation ─────────────────────────────────────────────────────

function isSymlinkZipEntry(entry) {
  const unix = (entry.externalFileAttributes >>> 16) & 0xFFFF;
  return unix !== 0 && (unix & 0xF000) === 0xA000;
}

function validateZipEntries(entries) {
  if (entries.length > IMPORT_MAX_FILE_COUNT) {
    throw badRequest(
      `Archive contains too many files (limit: ${IMPORT_MAX_FILE_COUNT})`,
      'IMPORT_TOO_MANY_FILES',
    );
  }

  let totalDeclared = 0;
  for (const entry of entries) {
    const norm = path.normalize(entry.path);
    if (path.isAbsolute(norm) || norm.startsWith('..')) {
      throw badRequest('Unsafe path detected in archive', 'ZIP_SLIP_DETECTED');
    }
    if (isSymlinkZipEntry(entry)) {
      throw badRequest('Archive contains symbolic links', 'SYMLINK_IN_ARCHIVE');
    }
    if (!entry.path.endsWith('/')) {
      const ext = path.extname(entry.path).toLowerCase();
      if (DANGEROUS_EXTENSIONS.has(ext)) {
        throw badRequest(`Archive contains a forbidden file type: ${ext}`, 'FORBIDDEN_FILE_TYPE');
      }
    }
    // Guard against zip-bomb via inflated declared sizes.
    totalDeclared += entry.uncompressedSize || 0;
    if (totalDeclared > IMPORT_MAX_UNCOMPRESSED) {
      throw tooLarge(
        `Archive declared size exceeds the ${IMPORT_MAX_UNCOMPRESSED / 1024 / 1024} MB limit`,
        'IMPORT_TOO_LARGE_UNCOMPRESSED',
      );
    }
  }
}

// ─── ZIP structure detection ───────────────────────────────────────────────────

function detectZipStructure(zipDir) {
  const roots = new Map();

  for (const entry of zipDir.files) {
    const segs = entry.path.split('/').filter(Boolean);
    if (segs.length === 0) continue;
    const root = segs[0];
    if (!roots.has(root)) roots.set(root, { asFile: false, asDir: false });
    const info = roots.get(root);
    if (segs.length === 1 && !entry.path.endsWith('/')) {
      info.asFile = true;
    } else {
      info.asDir = true;
    }
  }

  if (roots.size === 0) return { type: 'ambiguous' };

  for (const name of roots.keys()) {
    if (ALL_MARKERS.has(name)) return { type: 'flat' };
  }

  if (roots.size === 1) {
    const [[rootDir, info]] = roots.entries();
    if (!info.asFile && info.asDir) {
      const hasMarkerInside = zipDir.files.some(e => {
        const segs = e.path.split('/').filter(Boolean);
        return segs.length >= 2 && segs[0] === rootDir && ALL_MARKERS.has(segs[1]);
      });
      if (hasMarkerInside) return { type: 'wrapped', rootDir };
    }
  }

  return { type: 'ambiguous' };
}

// ─── Post-extraction integrity check ─────────────────────────────────────────

// Walks the extracted tmp dir and rejects any symlinks or hardlinked files.
async function checkExtractedDir(dirPath) {
  const entries = await fsp.readdir(dirPath, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isSymbolicLink()) {
      throw badRequest('Extracted archive contains a symbolic link', 'SYMLINK_IN_ARCHIVE');
    }
    if (entry.isDirectory()) {
      await checkExtractedDir(fullPath);
    } else if (entry.isFile()) {
      const st = await fsp.lstat(fullPath).catch(() => null);
      if (st && st.nlink > 1) {
        throw badRequest('Extracted archive contains hardlinked files', 'HARDLINK_DETECTED');
      }
    }
  }
}

// ─── ZIP extraction ───────────────────────────────────────────────────────────

// Entry-by-entry extraction with:
//  - Real-byte tracking via Transform (zip-bomb protection beyond declared sizes)
//  - O_CREAT|O_EXCL|O_NOFOLLOW on every write (TOCTOU hardening, rejects duplicate entries)
async function extractZip(zipDir, structure, destDir) {
  const safeDestDir = path.resolve(destDir);
  const prefix = structure.type === 'wrapped' ? structure.rootDir + '/' : '';
  let extractedBytes = 0;

  for (const entry of zipDir.files) {
    let rel = entry.path;

    if (structure.type === 'wrapped') {
      if (!rel.startsWith(prefix)) continue;
      rel = rel.slice(prefix.length);
      if (!rel) continue;
      const firstSeg = rel.split('/')[0];
      if (!IMPORT_ALLOWED.has(firstSeg)) continue;
    }

    const destPath = path.join(destDir, rel);
    const safeDest = path.resolve(destPath);
    if (safeDest !== safeDestDir && !safeDest.startsWith(safeDestDir + path.sep)) continue;

    if (rel.endsWith('/') || entry.type === 'Directory') {
      await fsp.mkdir(destPath, { recursive: true });
    } else {
      await fsp.mkdir(path.dirname(destPath), { recursive: true });
      await new Promise((resolve, reject) => {
        let settled = false;
        const settle = (fn, val) => { if (!settled) { settled = true; fn(val); } };

        // Count actual inflated bytes to catch zip-bombs with honest headers
        // and those that lie about uncompressedSize in the central directory.
        const counter = new Transform({
          transform(chunk, _enc, cb) {
            extractedBytes += chunk.length;
            if (extractedBytes > IMPORT_MAX_UNCOMPRESSED) {
              cb(tooLarge(
                `Archive real size exceeds the ${IMPORT_MAX_UNCOMPRESSED / 1024 / 1024} MB limit`,
                'IMPORT_TOO_LARGE_UNCOMPRESSED',
              ));
            } else {
              cb(null, chunk);
            }
          },
        });

        // O_EXCL prevents writing to a pre-existing path (duplicate entries, TOCTOU).
        const ws  = fs.createWriteStream(destPath, { flags: WRITE_FLAGS, mode: 0o600 });
        const src = entry.stream();

        src.on('error',     err => { counter.destroy(); ws.destroy(); settle(reject, err); });
        counter.on('error', err => { ws.destroy(); settle(reject, err); });
        ws.on('error',      err => settle(reject,
          err.code === 'EEXIST'
            ? badRequest('Archive contains duplicate entries', 'DUPLICATE_ENTRY')
            : err,
        ));
        ws.on('finish', () => settle(resolve));

        src.pipe(counter).pipe(ws);
      });
    }
  }
}

// ─── Multipart parsing for import ────────────────────────────────────────────

function _parseImportMultipart(serverPath, req) {
  return new Promise((resolve, reject) => {
    let fieldName    = null;
    let originalFile = null;
    let tmpZipPath   = null;
    let sizeExceeded = false;
    let writeError   = null;
    let rejected     = false;

    function safeReject(err) {
      if (rejected) return;
      rejected = true;
      if (tmpZipPath) { fsp.unlink(tmpZipPath).catch(() => {}); tmpZipPath = null; }
      reject(err);
    }

    const bb = busboy({ headers: req.headers, limits: { files: 1, fileSize: IMPORT_MAX_BYTES } });

    bb.on('field', (name, val) => {
      if (name === 'name') fieldName = val.trim() || null;
    });

    bb.on('file', (field, stream, info) => {
      if (field !== 'world') { stream.resume(); return; }

      originalFile = info.filename || '';
      const ext = path.extname(originalFile).toLowerCase();
      if (ext !== '.zip') {
        stream.resume();
        return safeReject(badRequest('Only .zip files are accepted', 'INVALID_EXTENSION'));
      }

      tmpZipPath = path.join(serverPath, `.tmp-upload-${uuidv4()}.zip`);
      const ws = fs.createWriteStream(tmpZipPath);

      stream.on('limit', () => { sizeExceeded = true; stream.destroy(); ws.destroy(); });
      ws.on('error', err => { writeError = err; });
      stream.pipe(ws);
    });

    bb.on('error', safeReject);

    bb.on('close', async () => {
      if (rejected) return;

      if (sizeExceeded) {
        if (tmpZipPath) await fsp.unlink(tmpZipPath).catch(() => {});
        return safeReject(tooLarge('Archive exceeds the allowed size limit', 'IMPORT_TOO_LARGE'));
      }
      if (!tmpZipPath) {
        return safeReject(badRequest('Field "world" with a .zip file is required', 'MISSING_FILE'));
      }
      if (writeError) {
        await fsp.unlink(tmpZipPath).catch(() => {});
        return safeReject(writeError);
      }

      const targetName = fieldName || path.basename(originalFile, '.zip');
      resolve({ targetName, tmpZipPath });
    });

    req.pipe(bb);
  });
}

// ─── Stale tmp cleanup (runs once on module load, non-blocking) ───────────────

async function _removeStaleTmp(fullPath, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await fsp.rm(fullPath, { recursive: true, force: true });
      log('warn', 'stale_tmp_removed', { path: fullPath, attempt });
      return;
    } catch (err) {
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, attempt * 100)); // 100ms, 200ms back-off
      } else {
        log('error', 'stale_tmp_remove_failed', {
          path: fullPath, attempts: maxRetries,
          error: err.message, code: err.code,
        });
      }
    }
  }
}

(async function cleanupStaleTmp() {
  try {
    const servers = await fsp.readdir(SERVERS_ROOT, { withFileTypes: true });
    for (const dirent of servers) {
      if (!dirent.isDirectory()) continue;
      const srvPath = path.join(SERVERS_ROOT, dirent.name);
      let entries;
      try { entries = await fsp.readdir(srvPath); } catch { continue; }
      for (const name of entries) {
        if (!name.startsWith('.tmp-import-') && !name.startsWith('.tmp-upload-')) continue;
        await _removeStaleTmp(path.join(srvPath, name));
      }
    }
  } catch { /* SERVERS_ROOT may not exist yet at first boot */ }
})().catch(() => {});

// ─── Public API ───────────────────────────────────────────────────────────────

async function listWorlds(serverPath) {
  validateServerPath(serverPath);
  const levelName = await readLevelName(serverPath);
  let entries;
  try {
    entries = await fsp.readdir(serverPath, { withFileTypes: true });
  } catch (err) {
    log('error', 'worlds:list:readdir_failed', { error: err.message, code: err.code });
    throw internal('Failed to read server directory');
  }

  const worlds = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (WORLD_BLACKLIST.has(entry.name)) continue;
    const worldPath = path.join(serverPath, entry.name);
    try {
      const lst = await fsp.lstat(worldPath);
      if (lst.isSymbolicLink()) continue;
    } catch { continue; }
    if (!(await hasWorldMarkers(worldPath))) continue;
    worlds.push(await buildWorld(serverPath, entry.name, levelName));
  }

  worlds.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return worlds;
}

async function getWorld(serverPath, name) {
  validateServerPath(serverPath);
  validateName(name);
  resolveWorldPath(serverPath, name);
  if (!(await isValidWorld(serverPath, name))) throw notFound('World not found', 'WORLD_NOT_FOUND');
  const levelName = await readLevelName(serverPath);
  return buildWorld(serverPath, name, levelName);
}

async function setActiveWorld(serverId, serverPath, name) {
  validateServerPath(serverPath);
  validateName(name);
  const worldPath = resolveWorldPath(serverPath, name);

  const serverModel = require('../models/serverModel');
  const server = serverModel.findById(serverId);
  if (!server) throw notFound('Server not found', 'SERVER_NOT_FOUND');
  if (server.status === 'running') throw conflict('Server is running', 'SERVER_RUNNING');

  const exists = await fsp.access(worldPath).then(() => true).catch(() => false);
  if (exists && !(await isValidWorld(serverPath, name))) {
    throw badRequest('Target directory exists but is not a valid Minecraft world', 'INVALID_WORLD');
  }

  return withMutex(serverId, async () => {
    // Re-check inside the mutex to close the TOCTOU window between the outer
    // status check and the actual write (server could start in between).
    const sv = serverModel.findById(serverId);
    if (!sv) throw notFound('Server not found', 'SERVER_NOT_FOUND');
    if (sv.status === 'running') throw conflict('Server is running', 'SERVER_RUNNING');
    await writeLevelName(serverPath, name);
    log('info', 'world:active_changed', { serverId, name });
    return { active: name };
  });
}

async function deleteWorld(serverId, serverPath, name) {
  validateServerPath(serverPath);
  validateName(name);
  const worldPath = resolveWorldPath(serverPath, name);
  await checkNotSymlink(worldPath);
  if (!(await isValidWorld(serverPath, name))) throw notFound('World not found', 'WORLD_NOT_FOUND');

  return withMutex(serverId, async () => {
    const serverModel = require('../models/serverModel');
    const server = serverModel.findById(serverId);
    if (!server) throw notFound('Server not found', 'SERVER_NOT_FOUND');
    if (server.status === 'running') throw conflict('Server is running', 'SERVER_RUNNING');

    const levelName = await readLevelName(serverPath);
    if (name === levelName) throw conflict('Cannot delete the active world', 'ACTIVE_WORLD_PROTECTED');

    await fsp.rm(worldPath, { recursive: true, force: false });
    sizeCache.delete(worldPath);
    log('info', 'world:deleted', { serverId, name });
  });
}

async function importWorld(serverId, serverPath, req) {
  validateServerPath(serverPath);
  const serverModel = require('../models/serverModel');
  const server = serverModel.findById(serverId);
  if (!server) throw notFound('Server not found', 'SERVER_NOT_FOUND');
  if (server.status === 'running') throw conflict('Server is running', 'SERVER_RUNNING');

  const { targetName, tmpZipPath } = await _parseImportMultipart(serverPath, req);

  try {
    validateName(targetName);
    const worldPath = resolveWorldPath(serverPath, targetName);

    const exists = await fsp.access(worldPath).then(() => true).catch(() => false);
    if (exists) throw conflict('A world with this name already exists', 'WORLD_ALREADY_EXISTS');

    return await withMutex(serverId, async () => {
      let tmpImportDir = null;
      try {
        const sv = serverModel.findById(serverId);
        if (!sv) throw notFound('Server not found', 'SERVER_NOT_FOUND');
        if (sv.status === 'running') throw conflict('Server is running', 'SERVER_RUNNING');

        const existsNow = await fsp.access(worldPath).then(() => true).catch(() => false);
        if (existsNow) throw conflict('A world with this name already exists', 'WORLD_ALREADY_EXISTS');

        let zipDir;
        try {
          zipDir = await unzipper.Open.file(tmpZipPath);
        } catch {
          throw badRequest('Archive is corrupted or invalid', 'ARCHIVE_CORRUPTED');
        }

        validateZipEntries(zipDir.files);

        const structure = detectZipStructure(zipDir);
        if (structure.type === 'ambiguous') {
          throw badRequest(
            'Archive contains no valid Minecraft world data or has an ambiguous structure',
            'AMBIGUOUS_ARCHIVE_STRUCTURE',
          );
        }

        tmpImportDir = path.join(serverPath, `.tmp-import-${uuidv4()}`);
        await fsp.mkdir(tmpImportDir, { recursive: true });
        await extractZip(zipDir, structure, tmpImportDir);

        // Post-extraction integrity: reject symlinks and hardlinks that bypassed zip metadata.
        await checkExtractedDir(tmpImportDir);

        // Atomic move to final location (same partition — rename is O(1)).
        await fsp.rename(tmpImportDir, worldPath);
        tmpImportDir = null;

        const size      = await computeSizeSync(worldPath);
        const updatedAt = (await fsp.stat(worldPath)).mtime.toISOString();

        log('info', 'world:imported', { serverId, name: targetName, size });
        return { name: targetName, active: false, size, updatedAt };
      } finally {
        if (tmpImportDir) await fsp.rm(tmpImportDir, { recursive: true, force: true }).catch(() => {});
      }
    });
  } finally {
    await fsp.unlink(tmpZipPath).catch(() => {});
  }
}

async function exportWorld(serverId, serverPath, name, res) {
  validateServerPath(serverPath);
  validateName(name);
  resolveWorldPath(serverPath, name);
  await checkNotSymlink(path.join(serverPath, name));
  if (!(await isValidWorld(serverPath, name))) throw notFound('World not found', 'WORLD_NOT_FOUND');

  const serverModel = require('../models/serverModel');
  const server = serverModel.findById(serverId);
  if (server?.status === 'running') {
    throw conflict('Stop the server before exporting a world', 'SERVER_RUNNING');
  }

  const worldPath = path.join(serverPath, name);
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${name}-export-${date}.zip"`);

  log('info', 'world:export:start', { name });

  await new Promise((resolve, reject) => {
    let done = false;
    const settle = (fn, val) => { if (!done) { done = true; fn(val); } };

    const archive = archiver('zip', { zlib: { level: 6 } });

    archive.on('error', err => {
      log('error', 'world:export:error', { name, error: err.message });
      if (!res.writableEnded && !res.destroyed) res.destroy(err);
      settle(reject, err);
    });

    res.on('error', err => {
      log('error', 'world:export:response_error', { name, error: err.message });
      settle(reject, err);
    });

    res.on('finish', () => {
      log('info', 'world:export:complete', { name });
      settle(resolve);
    });

    archive.pipe(res);
    archive.directory(worldPath, name, entry =>
      path.extname(entry.name) === '.lock' ? false : entry
    );
    archive.finalize();
  });
}

module.exports = {
  listWorlds, getWorld, setActiveWorld, deleteWorld, importWorld, exportWorld,
  reqCtx,
  readLevelName, // exported for backupService to compute dynamic world directories
};
