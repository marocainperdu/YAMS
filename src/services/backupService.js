'use strict';

const fs       = require('fs');
const fsp      = require('fs/promises');
const path     = require('path');
const { v4: uuidv4 } = require('uuid');
const archiver  = require('archiver');
const unzipper  = require('unzipper');

const { badRequest, notFound, conflict, forbidden, internal } = require('../utils/errors');
const { validateZipEntries, checkExtractedDir, extractToDir } = require('../utils/zipSecurity');

const SERVERS_ROOT = process.env.YAMS_SERVERS_ROOT
  || path.join(__dirname, '..', '..', 'servers');

// Directories excluded from backup archives (never backed up, never restored).
const EXCLUDE_DIRS = new Set(['logs', 'crash-reports', 'backups']);

// Server IDs currently being backed up — prevents concurrent backups per server.
const activeBackups = new Set();

// Server IDs currently being restored — prevents concurrent restores per server.
const activeRestores = new Set();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Path helpers ─────────────────────────────────────────────────────────────

function resolveServerRoot(serverPathOrId) {
  const root     = path.resolve(SERVERS_ROOT);
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

// ─── Derive world directories from server.properties ─────────────────────────
//
// Reads level-name from server.properties (same logic as worldService.readLevelName,
// shared via export).  Derives the three standard Minecraft world directories.
// Falls back to 'world' if server.properties is absent or has no level-name key.

async function _getWorldDirs(serverRoot) {
  const { readLevelName } = require('./worldService');
  const levelName = await readLevelName(serverRoot);
  const base = levelName.trim() || 'world';
  return [base, `${base}_nether`, `${base}_the_end`];
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
    const id = file.slice(0, -4);
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

async function createBackup(serverId, serverPathOrId, { force = false } = {}) {
  const serverRoot = resolveServerRoot(serverPathOrId || serverId);

  const serverModel = require('../models/serverModel');
  const server = serverModel.findById(serverId);
  if (!force && server?.status === 'running') {
    throw conflict('Stop the server before creating a backup', 'SERVER_RUNNING');
  }

  if (activeRestores.has(serverId)) {
    throw conflict('A restore is in progress for this server; cannot create backup');
  }
  if (activeBackups.has(serverId)) {
    throw conflict('A backup is already in progress for this server');
  }
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
//
// Security improvements vs. the old implementation:
//
//   1. validateZipEntries — zip-slip, symlinks, dangerous extensions, declared-size
//      bomb protection (same checks as worldService.importWorld).
//   2. extractToDir — entry-by-entry with a Transform byte-counter (real-size
//      bomb protection) and O_CREAT|O_EXCL|O_NOFOLLOW per-file write flags.
//   3. checkExtractedDir — post-extraction lstat pass that rejects any symlinks
//      or hardlinked files that bypassed ZIP metadata.
//   4. Atomic restore — the archive is fully extracted into a temp dir before
//      any live file is touched.  World directories are then swapped atomically
//      (rename); non-world items are moved last.  On any failure the live
//      directories are restored from .restore-bak copies.
//   5. Dynamic world dirs — derived from server.properties level-name instead of
//      the former hardcoded ['world', 'world_nether', 'world_the_end'] list.

async function restoreBackup(serverId, backupId, serverPathOrId) {
  const serverRoot = resolveServerRoot(serverPathOrId || serverId);

  if (activeBackups.has(serverId)) {
    throw conflict('A backup is in progress for this server; cannot restore');
  }
  if (activeRestores.has(serverId)) {
    throw conflict('A restore is already in progress for this server');
  }
  activeRestores.add(serverId);

  let tmpRestoreDir = null;

  try {
    const backup = await findBackup(serverRoot, backupId);

    // Lazy-require to avoid circular dependency with serverService.
    const serverModel = require('../models/serverModel');
    const server = serverModel.findById(serverId);
    if (!server) throw notFound('Server not found');

    // Compute world dirs BEFORE stopping the server (reads current server.properties).
    const worldDirNames = await _getWorldDirs(serverRoot);
    const worldDirSet   = new Set(worldDirNames);

    // Stop the server and wait for the real OS-level process exit.
    if (server.status === 'running') {
      const { stopServer, getChildProcess } = require('./serverService');
      const child = getChildProcess(serverId);

      let waitForExit = Promise.resolve();
      if (child) {
        waitForExit = new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(internal('Server did not stop within 30 s; restore aborted')),
            30_000,
          );
          child.once('exit', () => { clearTimeout(timeout); resolve(); });
        });
      }

      stopServer(serverId);
      await waitForExit;
    }

    // ── 1. Open and validate archive ────────────────────────────────────────

    let zipDir;
    try {
      zipDir = await unzipper.Open.file(backup.filePath);
    } catch (err) {
      throw badRequest(`Invalid or corrupted zip archive: ${err.message}`);
    }

    validateZipEntries(zipDir.files);

    // ── 2. Extract to temp dir (no live files touched yet) ──────────────────

    tmpRestoreDir = path.join(serverRoot, `.tmp-restore-${uuidv4()}`);
    await fsp.mkdir(tmpRestoreDir, { recursive: true });
    await extractToDir(zipDir, tmpRestoreDir);

    // Post-extraction integrity: symlinks / hardlinks that bypassed ZIP metadata.
    await checkExtractedDir(tmpRestoreDir);

    // ── 3. Atomic world-dir swap ─────────────────────────────────────────────
    //
    // Save live world dirs as .restore-bak before removing them so we can roll
    // back if the subsequent merge step fails.

    const savedWorlds = [];
    for (const wd of worldDirNames) {
      const live = path.join(serverRoot, wd);
      // Path-confinement guard — level-name could theoretically contain traversal.
      if (!live.startsWith(serverRoot + path.sep)) continue;
      const bak = `${live}.restore-bak`;
      try {
        await fsp.access(live);
        await fsp.rm(bak, { recursive: true, force: true });
        await fsp.rename(live, bak);
        savedWorlds.push({ live, bak });
      } catch { /* world dir absent in live server — nothing to save */ }
    }

    try {
      // Move all items from the temp dir into the live server root.
      // World dirs: destination is already gone (renamed to .restore-bak above),
      //   so rename() is atomic.
      // Non-world dirs: remove destination first (overwrite), then rename().
      // Files: rename() overwrites atomically on Linux.
      const tmpEntries = await fsp.readdir(tmpRestoreDir, { withFileTypes: true });
      for (const entry of tmpEntries) {
        // Never overwrite or create backups / logs inside the live root from a restore.
        if (EXCLUDE_DIRS.has(entry.name)) continue;

        const src = path.join(tmpRestoreDir, entry.name);
        const dst = path.join(serverRoot, entry.name);

        // Final confinement check.
        if (!dst.startsWith(serverRoot + path.sep) && dst !== serverRoot) continue;

        if (entry.isDirectory() && !worldDirSet.has(entry.name)) {
          // Remove existing non-world directory before rename (rename fails if dst exists).
          await fsp.rm(dst, { recursive: true, force: true }).catch(() => {});
        }
        await fsp.rename(src, dst);
      }

      // Success — discard the .restore-bak safety copies.
      for (const { bak } of savedWorlds) {
        await fsp.rm(bak, { recursive: true, force: true }).catch(() => {});
      }
    } catch (err) {
      // Merge failed — restore the world dirs from .restore-bak.
      for (const { live, bak } of savedWorlds) {
        await fsp.rm(live, { recursive: true, force: true }).catch(() => {});
        await fsp.rename(bak, live).catch(() => {});
      }
      throw internal(`Restore merge failed: ${err.message}`);
    }
  } finally {
    activeRestores.delete(serverId);
    if (tmpRestoreDir) {
      await fsp.rm(tmpRestoreDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function isRestoring(serverId) {
  return activeRestores.has(serverId);
}

module.exports = { createBackup, listBackups, findBackup, deleteBackup, streamBackup, restoreBackup, isRestoring };
