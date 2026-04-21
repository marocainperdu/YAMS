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

module.exports = { listDirectory, downloadFile, uploadFile, FILE_UPLOAD_LIMIT, FILE_LIST_LIMIT };
