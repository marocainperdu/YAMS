'use strict';

const busboy = require('busboy');
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

async function rejectSymlinkDeep(resolvedPath, rootPath) {
  const relative = path.relative(rootPath, resolvedPath);
  if (!relative) return; // resolvedPath IS rootPath — nothing to walk
  const segments = relative.split(path.sep).filter(Boolean);
  let current = rootPath;
  for (const segment of segments) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = await fsp.lstat(current);
    } catch (err) {
      if (err.code === 'ENOENT') return; // path doesn't exist here or below — safe
      throw err;
    }
    if (stat.isSymbolicLink()) throw forbidden('Symlinks are not permitted');
  }
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

  const nonSymlinks = entries.filter(e => !e.isSymbolicLink());
  const truncated   = nonSymlinks.length > FILE_LIST_LIMIT;
  const slice       = nonSymlinks.slice(0, FILE_LIST_LIMIT);

  const data = await Promise.all(
    slice.map(async (e) => {
        const stat = await fsp.stat(path.join(resolved, e.name)).catch(() => null);
        if (e.isDirectory()) {
          return { name: e.name, type: 'directory', modified: stat ? stat.mtimeMs : null };
        }
        return { name: e.name, type: 'file', size: stat ? stat.size : null, modified: stat ? stat.mtimeMs : null };
      })
  );

  data.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
  });

  return { data, truncated };
}

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

// ─── uploadFile ───────────────────────────────────────────────────────────────

async function uploadFile(serverId, destDir, req, overwrite) {
  const { resolved: destResolved, serverRoot } = resolveSafePath(serverId, destDir);
  await rejectSymlinkDeep(destResolved, serverRoot);

  return new Promise((resolve, reject) => {
    let tmpPath          = null;
    let finalPath        = null;
    let ws               = null;
    let writeError       = null;
    let overwriteBlocked = false;
    let sizeExceeded     = false;
    let rejected         = false;

    function safeReject(err) {
      if (rejected) return;
      rejected = true;
      reject(err);
    }

    const bb = busboy({
      headers: req.headers,
      limits: { files: 1, fileSize: FILE_UPLOAD_LIMIT },
    });

    bb.on('file', async (fieldname, stream, info) => {
      try {
        const filename = path.basename(info.filename || '');
        if (!filename) {
          stream.resume();
          return safeReject(badRequest('Uploaded file has no name'));
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

        ws = fs.createWriteStream(tmpPath);

        stream.on('limit', () => {
          sizeExceeded = true;
          stream.destroy();
          ws.destroy();
        });

        stream.pipe(ws);
        ws.on('error', (err) => { writeError = err; });
      } catch (err) {
        stream.resume();
        safeReject(err);
      }
    });

    bb.on('close', async () => {
      try {
        if (sizeExceeded) {
          if (tmpPath) await fsp.unlink(tmpPath).catch(() => {});
          return safeReject(badRequest(`File exceeds the ${FILE_UPLOAD_LIMIT}-byte upload limit`));
        }
        if (overwriteBlocked) {
          return safeReject(conflict('File already exists. Send overwrite=true to replace it'));
        }
        if (writeError) {
          if (tmpPath) await fsp.unlink(tmpPath).catch(() => {});
          return safeReject(writeError);
        }
        if (!finalPath) {
          return safeReject(badRequest('No file was provided in the request'));
        }
        // Await write stream flush before renaming
        if (ws && !ws.writableFinished) {
          await new Promise((res, rej) => {
            ws.on('finish', res);
            ws.on('error', rej);
          });
        }
        await fsp.rename(tmpPath, finalPath);
        try {
          await rejectSymlinkDeep(finalPath, serverRoot);
        } catch (err) {
          await fsp.unlink(finalPath).catch(() => {});
          return safeReject(err);
        }
        resolve({ name: path.basename(finalPath) });
      } catch (err) {
        safeReject(err);
      }
    });

    bb.on('error', safeReject);
    req.pipe(bb);
  });
}

// ─── createFolder ─────────────────────────────────────────────────────────────

async function createFolder(serverId, dirPath) {
  const { resolved, serverRoot } = resolveSafePath(serverId, dirPath);
  await rejectSymlinkDeep(resolved, serverRoot);
  await fsp.mkdir(resolved, { recursive: true });
}

// ─── renameFile ───────────────────────────────────────────────────────────────

async function renameFile(serverId, fromPath, toPath) {
  const { resolved: from, serverRoot } = resolveSafePath(serverId, fromPath);
  const { resolved: to }               = resolveSafePath(serverId, toPath);

  if (from === serverRoot) throw forbidden('Cannot rename the server root directory');

  if (from === to) return;

  await rejectSymlinkDeep(from, serverRoot);
  await rejectSymlinkDeep(path.dirname(to), serverRoot);

  // Source-chain check is not TOCTOU-safe: a race win after this point may
  // redirect the source read outside the sandbox.
  // This may result in importing arbitrary host files into the server directory.
  try {
    await fsp.rename(from, to);
  } catch (err) {
    if (err.code === 'ENOENT') throw notFound('Path not found');
    if (err.code !== 'EXDEV') throw err;

    let fromStat;
    try {
      fromStat = await fsp.lstat(from);
    } catch (statErr) {
      if (statErr.code === 'ENOENT') throw notFound('Source file not found');
      throw statErr;
    }
    if (fromStat.isDirectory()) throw badRequest('Cross-device directory rename not supported');

    // EXDEV fallback may overwrite destination non-atomically.
    await fsp.copyFile(from, to);
    try {
      await rejectSymlinkDeep(to, serverRoot);
    } catch (guardErr) {
      await fsp.unlink(to).catch(() => {});
      throw guardErr;
    }
    await fsp.unlink(from);
    return;
  }

  try {
    await rejectSymlinkDeep(to, serverRoot);
  } catch (err) {
    await fsp.unlink(to).catch(() => {});
    throw err;
  }
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
