'use strict';

const busboy = require('busboy');
const path = require('path');
const fsp  = require('fs/promises');
const fs   = require('fs');

const { badRequest, notFound, conflict, forbidden } = require('../utils/errors');
const { securityLog } = require('../utils/securityLog');

const SERVERS_ROOT = process.env.YAMS_SERVERS_ROOT
  || path.join(__dirname, '..', '..', 'servers');

const FILE_UPLOAD_LIMIT = process.env.FILE_UPLOAD_LIMIT
  ? parseInt(process.env.FILE_UPLOAD_LIMIT, 10)
  : 524_288_000; // 500 MB

const FILE_LIST_LIMIT = process.env.FILE_LIST_LIMIT
  ? parseInt(process.env.FILE_LIST_LIMIT, 10)
  : 1000;

// Extensions that are never allowed as upload targets — prevents RCE via
// server.jar overwrite or execution of uploaded scripts on the host OS.
const FORBIDDEN_UPLOAD_EXTENSIONS = new Set([
  '.jar', '.sh', '.bash', '.exe', '.bat', '.cmd', '.ps1',
]);

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

function resolveSafePath(serverRootPath, userPath = '') {
  const serverRoot = path.resolve(serverRootPath);
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

async function listDirectory(serverRootPath, dirPath = '') {
  const { resolved } = resolveSafePath(serverRootPath, dirPath);

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

async function downloadFile(serverRootPath, filePath) {
  const { resolved } = resolveSafePath(serverRootPath, filePath);
  const stat = await rejectSymlink(resolved);

  if (stat.isDirectory()) throw badRequest('Cannot download a directory');

  const ext         = path.extname(resolved).toLowerCase();
  const contentType = MIME[ext] || DEFAULT_MIME;
  const filename    = path.basename(resolved);
  const stream      = fs.createReadStream(resolved);

  return { stream, filename, contentType, size: stat.size };
}

// ─── uploadFile ───────────────────────────────────────────────────────────────

async function uploadFile(serverRootPath, destDir, req, overwrite) {
  const { resolved: destResolved, serverRoot } = resolveSafePath(serverRootPath, destDir);
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

        // Reject executable / script uploads to prevent RCE.
        const ext = path.extname(filename).toLowerCase();
        if (FORBIDDEN_UPLOAD_EXTENSIONS.has(ext)) {
          stream.resume();
          securityLog('warn', 'upload.rejected', {
            ip:     req.ip ?? req.socket?.remoteAddress ?? 'unknown',
            userId: req.user?.userId ?? null,
            ext,
            serverId,
          });
          return safeReject(badRequest(`Uploading ${ext} files is not allowed`, 'FORBIDDEN_FILE_TYPE'));
        }

        const { resolved: fp } = resolveSafePath(serverRootPath, path.join(destDir, filename));
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

async function createFolder(serverRootPath, dirPath) {
  const { resolved, serverRoot } = resolveSafePath(serverRootPath, dirPath);
  await rejectSymlinkDeep(resolved, serverRoot);
  await fsp.mkdir(resolved, { recursive: true });
}

// ─── renameFile ───────────────────────────────────────────────────────────────

async function renameFile(serverRootPath, fromPath, toPath) {
  const { resolved: from, serverRoot } = resolveSafePath(serverRootPath, fromPath);
  const { resolved: to }               = resolveSafePath(serverRootPath, toPath);

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

async function deleteFile(serverRootPath, filePath) {
  const { resolved, serverRoot } = resolveSafePath(serverRootPath, filePath);

  if (resolved === serverRoot) throw forbidden('Cannot delete the server root directory');

  const stat = await rejectSymlink(resolved);

  if (stat.isDirectory()) {
    await fsp.rm(resolved, { recursive: true, force: true });
  } else {
    await fsp.unlink(resolved);
  }
}

const TEXT_EDIT_LIMIT = 1 * 1024 * 1024; // 1 MB — anything bigger is not fit for inline editing

async function readFileContent(serverRootPath, filePath) {
  const { resolved } = resolveSafePath(serverRootPath, filePath);
  const stat = await rejectSymlink(resolved);
  if (stat.isDirectory()) throw badRequest('Cannot read a directory as text');
  if (stat.size > TEXT_EDIT_LIMIT) throw badRequest('File exceeds the 1 MB inline-edit limit');
  const content = await fsp.readFile(resolved, 'utf8');
  return { content, size: stat.size };
}

async function writeFileContent(serverRootPath, filePath, content) {
  const { resolved, serverRoot } = resolveSafePath(serverRootPath, filePath);
  await rejectSymlinkDeep(resolved, serverRoot);
  const tmp = resolved + '.yams_edit_tmp';
  await fsp.writeFile(tmp, content, 'utf8');
  await fsp.rename(tmp, resolved);
}

module.exports = {
  listDirectory,
  downloadFile,
  uploadFile,
  createFolder,
  renameFile,
  deleteFile,
  readFileContent,
  writeFileContent,
  FILE_UPLOAD_LIMIT,
  FILE_LIST_LIMIT,
};
