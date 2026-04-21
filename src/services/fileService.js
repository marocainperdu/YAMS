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
