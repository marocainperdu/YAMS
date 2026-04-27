'use strict';

const fs       = require('fs');
const fsp      = require('fs/promises');
const path     = require('path');
const { v4: uuidv4 } = require('uuid');
const archiver  = require('archiver');
const unzipper  = require('unzipper');
const busboy    = require('busboy');

const { badRequest, notFound, conflict, tooLarge, internal } = require('../utils/errors');

const SERVERS_ROOT = process.env.YAMS_SERVERS_ROOT
  || path.join(__dirname, '..', '..', 'servers');

// ─── Constants ───────────────────────────────────────────────────────────────

const WORLD_BLACKLIST = new Set([
  'backups', 'logs', 'crash-reports', 'plugins', 'mods', 'config',
  'libraries', 'versions', 'assets', 'data', 'cache', 'dynmap',
  'BlueMap', 'LuckPerms',
]);

// level.dat is the strong marker (file); the rest are secondary markers (dirs)
const MARKER_FILE = 'level.dat';
const MARKER_DIRS = ['region', 'data', 'DIM-1', 'DIM1'];
const ALL_MARKERS = new Set([MARKER_FILE, ...MARKER_DIRS]);

// Allowed root-level entries when extracting a wrapped zip
const IMPORT_ALLOWED = new Set([MARKER_FILE, ...MARKER_DIRS]);

const IMPORT_MAX_BYTES = (Number(process.env.WORLD_IMPORT_MAX_SIZE_MB) || 2048) * 1024 * 1024;
const SIZE_CACHE_TTL   = Number(process.env.WORLD_SIZE_CACHE_TTL_MS) || 60_000;
const SIZE_TIMEOUT_MS  = 30_000;

// ─── In-memory state ─────────────────────────────────────────────────────────

// Mutex: FIFO promise chain per serverId
const mutexMap = new Map();

// Size cache: worldPath → { size: number|null, computedAt: number }
const sizeCache = new Map();

// In-flight size computations: worldPath → Promise<void>
const inFlightSize = new Map();

// ─── Mutex — explicit FIFO promise chaining ───────────────────────────────────

function withMutex(serverId, fn) {
  const prev = mutexMap.get(serverId) ?? Promise.resolve();
  // Chain fn onto the previous tail; this assignment is synchronous
  // so any subsequent call immediately sees the updated tail.
  const next = prev.then(() => fn()).finally(() => {
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

// Checks all markers in parallel via stat (no recursive descent).
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

// Returns the raw value for a given key (split on first '=', trim key only).
function extractKey(rawLine, targetKey) {
  const line = rawLine.replace(/\r$/, '');
  if (!line.includes('=') || line.trimStart().startsWith('#')) return null;
  const eqIdx = line.indexOf('=');
  if (line.slice(0, eqIdx).trim() !== targetKey) return null;
  return line.slice(eqIdx + 1); // raw value — no trim, no normalization
}

async function readLevelName(serverPath) {
  const propsPath = path.join(serverPath, 'server.properties');
  let content;
  try {
    content = await fsp.readFile(propsPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return 'world';
    throw err;
  }
  for (const line of content.split('\n')) {
    const val = extractKey(line, 'level-name');
    if (val !== null) return val;
  }
  return 'world';
}

async function writeLevelName(serverPath, newName) {
  const propsPath = path.join(serverPath, 'server.properties');
  const tmpPath   = `${propsPath}.tmp`;

  let lines = [];
  try {
    lines = (await fsp.readFile(propsPath, 'utf8')).split('\n');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  let found = false;
  const out = lines.map(line => {
    if (found) return line;
    const val = extractKey(line, 'level-name');
    if (val !== null) {
      found = true;
      return `level-name=${newName}`;
    }
    return line;
  });
  if (!found) out.push(`level-name=${newName}`);

  await fsp.writeFile(tmpPath, out.join('\n'), 'utf8');
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

// Launch a background computation for worldPath, deduplicating concurrent calls.
function _launchSizeCompute(worldPath) {
  if (inFlightSize.has(worldPath)) return; // reuse existing Promise

  // Store the Promise synchronously before any await — prevents a second caller
  // from launching a duplicate computation between now and the first await.
  const p = _computeSizeRaw(worldPath)
    .then(size => { sizeCache.set(worldPath, { size, computedAt: Date.now() }); })
    .catch(()  => { sizeCache.set(worldPath, { size: null, computedAt: Date.now() }); })
    .finally(() => { inFlightSize.delete(worldPath); });

  inFlightSize.set(worldPath, p);
}

// Return cached size (or null), and trigger background compute if needed.
function getCachedSize(worldPath) {
  const entry = sizeCache.get(worldPath);
  if (entry && Date.now() - entry.computedAt < SIZE_CACHE_TTL) return entry.size;
  _launchSizeCompute(worldPath);
  return null;
}

// Synchronous size computation for POST /import — awaits and populates cache.
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

// ─── ZIP structure detection ───────────────────────────────────────────────────

function detectZipStructure(zipDir) {
  // Build a map of root-level segment name → { asFile, asDir }
  const roots = new Map();

  for (const entry of zipDir.files) {
    const segs = entry.path.split('/').filter(Boolean);
    if (segs.length === 0) continue;
    const root = segs[0];
    if (!roots.has(root)) roots.set(root, { asFile: false, asDir: false });
    const info = roots.get(root);
    // A root-level file: single segment AND path does not end with '/'
    if (segs.length === 1 && !entry.path.endsWith('/')) {
      info.asFile = true;
    } else {
      info.asDir = true;
    }
  }

  if (roots.size === 0) return { type: 'ambiguous' };

  // Case 1 — Flat: at least one root segment is a Minecraft marker
  for (const name of roots.keys()) {
    if (ALL_MARKERS.has(name)) return { type: 'flat' };
  }

  // Case 2 — Wrapped: exactly one root segment (a directory), no root files,
  // and the directory contains at least one Minecraft marker inside it.
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

// ─── ZIP extraction ───────────────────────────────────────────────────────────

async function extractZip(zipDir, structure, destDir) {
  if (structure.type === 'flat') {
    await zipDir.extract({ path: destDir, concurrency: 5 });
    return;
  }

  // Wrapped: only extract allowed root-level entries from inside the single root dir.
  const prefix = structure.rootDir + '/';
  const safeDestDir = path.resolve(destDir);

  for (const entry of zipDir.files) {
    if (!entry.path.startsWith(prefix)) continue;
    const rel = entry.path.slice(prefix.length);
    if (!rel) continue; // the root directory entry itself

    // Check the first segment of rel against the allowed list
    const firstSeg = rel.split('/')[0];
    if (!IMPORT_ALLOWED.has(firstSeg)) continue; // silently ignore

    const destPath = path.join(destDir, rel);
    const safeDest = path.resolve(destPath);

    // Belt-and-suspenders path confinement (zip-slip already caught above)
    if (safeDest !== safeDestDir && !safeDest.startsWith(safeDestDir + path.sep)) continue;

    if (entry.path.endsWith('/')) {
      await fsp.mkdir(destPath, { recursive: true });
    } else {
      await fsp.mkdir(path.dirname(destPath), { recursive: true });
      await new Promise((resolve, reject) => {
        entry.stream()
          .pipe(fs.createWriteStream(destPath))
          .on('finish', resolve)
          .on('error', reject);
      });
    }
  }
}

// ─── Multipart parsing for import ────────────────────────────────────────────

function _parseImportMultipart(serverPath, req) {
  return new Promise((resolve, reject) => {
    let fieldName      = null;
    let originalFile   = null;
    let tmpZipPath     = null;
    let sizeExceeded   = false;
    let writeError     = null;
    let rejected       = false;

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

      stream.on('limit', () => {
        sizeExceeded = true;
        stream.destroy();
        ws.destroy();
      });

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

// ─── Public API ───────────────────────────────────────────────────────────────

async function listWorlds(serverPath) {
  const levelName = await readLevelName(serverPath);
  let entries;
  try {
    entries = await fsp.readdir(serverPath, { withFileTypes: true });
  } catch (err) {
    throw internal(`Failed to read server directory: ${err.message}`);
  }

  const worlds = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue; // also filters symlinks on Linux
    if (WORLD_BLACKLIST.has(entry.name)) continue;
    const worldPath = path.join(serverPath, entry.name);
    try {
      const lst = await fsp.lstat(worldPath);
      if (lst.isSymbolicLink()) continue;
    } catch { continue; }
    if (!(await hasWorldMarkers(worldPath))) continue;
    worlds.push(await buildWorld(serverPath, entry.name, levelName));
  }

  // Active world first, then alphabetical
  worlds.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return worlds;
}

async function getWorld(serverPath, name) {
  validateName(name);
  resolveWorldPath(serverPath, name); // confinement check (throws on failure)
  if (!(await isValidWorld(serverPath, name))) throw notFound('World not found', 'WORLD_NOT_FOUND');
  const levelName = await readLevelName(serverPath);
  return buildWorld(serverPath, name, levelName);
}

async function setActiveWorld(serverId, serverPath, name) {
  validateName(name);
  resolveWorldPath(serverPath, name); // confinement check

  const serverModel = require('../models/serverModel');
  const server = serverModel.findById(serverId);
  if (!server) throw notFound('Server not found', 'SERVER_NOT_FOUND');
  if (server.status === 'running') throw conflict('Server is running', 'SERVER_RUNNING');

  return withMutex(serverId, async () => {
    await writeLevelName(serverPath, name);
    return { active: name };
  });
}

async function deleteWorld(serverId, serverPath, name) {
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
  });
}

async function importWorld(serverId, serverPath, req) {
  const serverModel = require('../models/serverModel');
  const server = serverModel.findById(serverId);
  if (!server) throw notFound('Server not found', 'SERVER_NOT_FOUND');
  if (server.status === 'running') throw conflict('Server is running', 'SERVER_RUNNING');

  // Parse the multipart — saves zip to a temp file on the same partition
  const { targetName, tmpZipPath } = await _parseImportMultipart(serverPath, req);

  try {
    validateName(targetName);
    const worldPath = resolveWorldPath(serverPath, targetName);

    // Pre-mutex existence check (fast fail before queuing)
    const exists = await fsp.access(worldPath).then(() => true).catch(() => false);
    if (exists) throw conflict('A world with this name already exists', 'WORLD_ALREADY_EXISTS');

    return await withMutex(serverId, async () => {
      let tmpImportDir = null;
      try {
        // Re-verify inside the mutex (TOCTOU protection)
        const sv = serverModel.findById(serverId);
        if (!sv) throw notFound('Server not found', 'SERVER_NOT_FOUND');
        if (sv.status === 'running') throw conflict('Server is running', 'SERVER_RUNNING');

        const existsNow = await fsp.access(worldPath).then(() => true).catch(() => false);
        if (existsNow) throw conflict('A world with this name already exists', 'WORLD_ALREADY_EXISTS');

        // Open and validate zip
        let zipDir;
        try {
          zipDir = await unzipper.Open.file(tmpZipPath);
        } catch {
          throw badRequest('Archive is corrupted or invalid', 'ARCHIVE_CORRUPTED');
        }

        // Zip-slip check — reject the entire archive on first violation
        for (const entry of zipDir.files) {
          const norm = path.normalize(entry.path);
          if (path.isAbsolute(norm) || norm.startsWith('..')) {
            throw badRequest('Unsafe path detected in archive', 'ZIP_SLIP_DETECTED');
          }
        }

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

        // Atomic move to final location (same partition — guaranteed)
        await fsp.rename(tmpImportDir, worldPath);
        tmpImportDir = null;

        const size      = await computeSizeSync(worldPath);
        const updatedAt = (await fsp.stat(worldPath)).mtime.toISOString();
        return { name: targetName, active: false, size, updatedAt };
      } finally {
        if (tmpImportDir) await fsp.rm(tmpImportDir, { recursive: true, force: true }).catch(() => {});
      }
    });
  } finally {
    await fsp.unlink(tmpZipPath).catch(() => {});
  }
}

async function exportWorld(serverPath, name, res) {
  validateName(name);
  resolveWorldPath(serverPath, name); // confinement check
  await checkNotSymlink(path.join(serverPath, name));
  if (!(await isValidWorld(serverPath, name))) throw notFound('World not found', 'WORLD_NOT_FOUND');

  // All validation complete — safe to commit headers now
  const worldPath = path.join(serverPath, name);
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${name}-export-${date}.zip"`);

  await new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 6 } });

    archive.on('error', err => {
      console.error(`[YAMS] World export stream error (${name}):`, err);
      // Headers already sent — cannot write a JSON error body.
      // Destroy the socket immediately; the client receives an abrupt close.
      if (res.socket && !res.socket.destroyed) res.socket.destroy();
      reject(err);
    });

    res.on('error', reject);
    res.on('finish', resolve);

    archive.pipe(res);

    archive.directory(worldPath, name, entry =>
      path.extname(entry.name) === '.lock' ? false : entry
    );

    archive.finalize();
  });
}

module.exports = { listWorlds, getWorld, setActiveWorld, deleteWorld, importWorld, exportWorld };
