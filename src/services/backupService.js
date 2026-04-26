'use strict';

const fs       = require('fs');
const fsp      = require('fs/promises');
const path     = require('path');
const { v4: uuidv4 } = require('uuid');
const archiver  = require('archiver');
const unzipper  = require('unzipper');

const { badRequest, notFound, conflict, forbidden, internal } = require('../utils/errors');

const SERVERS_ROOT = process.env.YAMS_SERVERS_ROOT
  || path.join(__dirname, '..', '..', 'servers');

// Minecraft world directories safe to remove during restore
const WORLD_DIRS = ['world', 'world_nether', 'world_the_end'];

// Directories excluded from backup archives
const EXCLUDE_DIRS = new Set(['logs', 'crash-reports', 'backups']);

// Server IDs currently being backed up — prevents concurrent backups per server
const activeBackups = new Set();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Path helpers ─────────────────────────────────────────────────────────────

/**
 * Validate serverPath stays within SERVERS_ROOT and return it resolved.
 * Accepts either a full path (from server.path in DB) or a bare serverId
 * (used by unit tests that call the service directly with TEST_ROOT).
 */
function resolveServerRoot(serverPathOrId) {
  const root     = path.resolve(SERVERS_ROOT);
  // If the caller passed an absolute path use it directly; otherwise treat as
  // a relative id under SERVERS_ROOT (unit-test shorthand).
  const resolved = path.isAbsolute(serverPathOrId)
    ? path.resolve(serverPathOrId)
    : path.resolve(SERVERS_ROOT, serverPathOrId);

  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw forbidden('Server path escapes SERVERS_ROOT');
  }
  return resolved;
}

function getBackupsDir(serverRoot) {
  return path.join(serverRoot, 'backups');
}

function resolveBackupFilePath(serverRoot, backupId) {
  if (!UUID_RE.test(backupId)) throw badRequest('Invalid backup ID format');
  const backupsDir = path.resolve(getBackupsDir(serverRoot));
  const filePath   = path.resolve(backupsDir, `${backupId}.zip`);
  if (!filePath.startsWith(backupsDir + path.sep)) {
    throw forbidden('Backup path escapes backup directory');
  }
  return filePath;
}

function ensureBackupsDir(serverRoot) {
  const dir = getBackupsDir(serverRoot);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function formatDisplayName(mtimeMs) {
  const d   = new Date(mtimeMs);
  const pad = n => String(n).padStart(2, '0');
  return `backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}.zip`;
}

// ─── listBackups ──────────────────────────────────────────────────────────────

async function listBackups(serverPathOrId) {
  const serverRoot = resolveServerRoot(serverPathOrId);
  const backupsDir = getBackupsDir(serverRoot);

  try { await fsp.access(backupsDir); } catch { return []; }

  const files   = await fsp.readdir(backupsDir);
  const backups = [];

  for (const file of files) {
    if (!file.endsWith('.zip') || file.endsWith('.tmp.zip')) continue;
    const id = file.slice(0, -4); // strip .zip
    if (!UUID_RE.test(id)) continue;

    const filePath = path.join(backupsDir, file);
    try {
      const stat = await fsp.stat(filePath);
      backups.push({ id, name: formatDisplayName(stat.mtimeMs), size: stat.size, createdAt: stat.mtimeMs });
    } catch { /* skip unreadable files */ }
  }

  return backups.sort((a, b) => b.createdAt - a.createdAt);
}

// ─── findBackup ───────────────────────────────────────────────────────────────

async function findBackup(serverPathOrId, backupId) {
  const serverRoot = resolveServerRoot(serverPathOrId);
  const filePath   = resolveBackupFilePath(serverRoot, backupId);

  try {
    const stat = await fsp.stat(filePath);
    return { id: backupId, name: formatDisplayName(stat.mtimeMs), size: stat.size, createdAt: stat.mtimeMs, filePath };
  } catch {
    throw notFound(`Backup ${backupId} not found`);
  }
}

// ─── createBackup ─────────────────────────────────────────────────────────────

/**
 * @param {string} serverId   UUID — used for concurrent-lock key
 * @param {string} serverPathOrId  Actual path to server directory (or bare id for unit tests)
 */
async function createBackup(serverId, serverPathOrId) {
  // Support unit-test shorthand: createBackup(id) with id == relative dir name
  const serverRoot = resolveServerRoot(serverPathOrId || serverId);

  if (activeBackups.has(serverId)) {
    throw conflict('A backup is already in progress for this server');
  }
  // Add synchronously before any await — eliminates the race window where two
  // concurrent callers both pass the has() check before either runs add().
  activeBackups.add(serverId);

  let tmpPath;
  try {
    const backupsDir = ensureBackupsDir(serverRoot);
    const id         = uuidv4();
    tmpPath          = path.join(backupsDir, `${id}.tmp.zip`);
    const finalPath  = path.join(backupsDir, `${id}.zip`);

    await new Promise((resolve, reject) => {
      const output  = fs.createWriteStream(tmpPath);
      const archive = archiver('zip', { zlib: { level: 6 } });

      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);

      const entries = fs.readdirSync(serverRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (EXCLUDE_DIRS.has(entry.name)) continue;
        const fullPath = path.join(serverRoot, entry.name);
        if (entry.isDirectory()) {
          archive.directory(fullPath, entry.name, (data) =>
            path.extname(data.name) === '.lock' ? false : data
          );
        } else {
          if (path.extname(entry.name) === '.lock') continue;
          archive.file(fullPath, { name: entry.name });
        }
      }

      archive.finalize();
    });

    await fsp.rename(tmpPath, finalPath);

    const stat = await fsp.stat(finalPath);
    return { id, name: formatDisplayName(stat.mtimeMs), size: stat.size, createdAt: stat.mtimeMs };
  } catch (err) {
    try { await fsp.unlink(tmpPath); } catch { /* already cleaned up */ }
    throw err;
  } finally {
    activeBackups.delete(serverId);
  }
}

// ─── deleteBackup ─────────────────────────────────────────────────────────────

async function deleteBackup(serverPathOrId, backupId) {
  const backup = await findBackup(serverPathOrId, backupId);
  await fsp.unlink(backup.filePath);
}

// ─── streamBackup ─────────────────────────────────────────────────────────────

async function streamBackup(serverPathOrId, backupId, res) {
  const backup = await findBackup(serverPathOrId, backupId);
  const stat   = await fsp.stat(backup.filePath);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${backup.name}"`);
  res.setHeader('Content-Length', String(stat.size));

  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(backup.filePath);
    stream.on('error', reject);
    res.on('error', reject);
    res.on('finish', resolve);
    stream.pipe(res);
  });
}

// ─── restoreBackup ────────────────────────────────────────────────────────────

/**
 * @param {string} serverId       UUID — used for DB lookup and process check
 * @param {string} backupId       UUID of the backup to restore
 * @param {string} serverPathOrId Actual path to server directory (or bare id for unit tests)
 */
async function restoreBackup(serverId, backupId, serverPathOrId) {
  const serverRoot = resolveServerRoot(serverPathOrId || serverId);
  const backup     = await findBackup(serverRoot, backupId);

  // Lazy-require to avoid circular dependency with serverService
  const serverModel = require('../models/serverModel');
  const server = serverModel.findById(serverId);
  if (!server) throw notFound('Server not found');

  // 1. Stop server if running, then wait for full shutdown
  if (server.status === 'running') {
    const { stopServer } = require('./serverService');
    await stopServer(serverId);

    const deadline = Date.now() + 30_000;
    while (true) {
      const current = serverModel.findById(serverId);
      if (!current || current.status !== 'running') break;
      if (Date.now() > deadline) {
        throw internal('Server did not stop within 30 s; restore aborted');
      }
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // 2. Validate archive integrity and guard against zip-slip — BEFORE any deletion
  let zipDir;
  try {
    zipDir = await unzipper.Open.file(backup.filePath);
  } catch (err) {
    throw badRequest(`Invalid or corrupted zip archive: ${err.message}`);
  }

  for (const file of zipDir.files) {
    const normalized = path.normalize(file.path);
    if (path.isAbsolute(normalized) || normalized.startsWith('..')) {
      throw badRequest(`Unsafe path in archive: ${file.path}`);
    }
  }

  // 3. Delete current world directories (safe list only)
  for (const worldDir of WORLD_DIRS) {
    const worldPath = path.join(serverRoot, worldDir);
    if (!worldPath.startsWith(serverRoot + path.sep)) continue;
    try { await fsp.rm(worldPath, { recursive: true, force: true }); } catch { /* may not exist */ }
  }

  // 4. Extract backup into server root
  try {
    await zipDir.extract({ path: serverRoot, concurrency: 5 });
  } catch (err) {
    throw internal(`Extraction failed: ${err.message}`);
  }
}

module.exports = { createBackup, listBackups, findBackup, deleteBackup, streamBackup, restoreBackup };
