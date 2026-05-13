'use strict';

const fs   = require('fs');
const fsp  = require('fs/promises');
const path = require('path');
const { Transform } = require('stream');

const { badRequest, tooLarge } = require('./errors');

// ─── Shared constants ─────────────────────────────────────────────────────────

const IMPORT_MAX_UNCOMPRESSED = (Number(process.env.WORLD_IMPORT_MAX_UNCOMPRESSED_MB) || 500) * 1024 * 1024;
const IMPORT_MAX_FILE_COUNT   = Number(process.env.WORLD_IMPORT_MAX_FILES) || 10_000;

const DANGEROUS_EXTENSIONS = new Set([
  '.sh', '.bash', '.zsh', '.exe', '.jar', '.bat',
  '.cmd', '.com', '.ps1', '.py', '.rb', '.php', '.pl',
]);

// O_NOFOLLOW: reject if the last path component is a symlink (Linux/macOS; 0 on Windows — no-op).
const O_NOFOLLOW  = fs.constants.O_NOFOLLOW ?? 0;
// O_EXCL: fail if the file already exists — prevents TOCTOU and duplicate-entry attacks.
const WRITE_FLAGS = fs.constants.O_CREAT | fs.constants.O_WRONLY | fs.constants.O_EXCL | O_NOFOLLOW;

// ─── Zip-entry helpers ────────────────────────────────────────────────────────

function isSymlinkZipEntry(entry) {
  const unix = (entry.externalFileAttributes >>> 16) & 0xFFFF;
  return unix !== 0 && (unix & 0xF000) === 0xA000;
}

// ─── Entry validation (zip-slip, symlinks, extensions, size limits) ───────────

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

// ─── Post-extraction integrity check ─────────────────────────────────────────

// Walks an extracted directory and rejects any symlinks or hardlinked files.
// Catches attacks that slip past ZIP metadata (e.g. hardlinks constructed at OS level).
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

// ─── Flat extraction (no flat/wrapped detection — all entries go to destDir) ──
//
// Used by backupService where archives are created by YAMS and have a flat
// (non-wrapped) structure. The same Transform-counter zip-bomb protection and
// O_EXCL per-file write hardening as worldService.extractZip are applied.

async function extractToDir(zipDir, destDir) {
  const safeDestDir = path.resolve(destDir);
  let extractedBytes = 0; // shared across all entries — catches multi-entry zip-bombs

  for (const entry of zipDir.files) {
    const norm     = path.normalize(entry.path);
    const destPath = path.join(destDir, norm);
    const safeDest = path.resolve(destPath);

    // Final path-confinement guard (entries were already validated, but defence-in-depth).
    if (safeDest !== safeDestDir && !safeDest.startsWith(safeDestDir + path.sep)) continue;

    if (norm.endsWith('/') || entry.type === 'Directory') {
      await fsp.mkdir(destPath, { recursive: true });
    } else {
      await fsp.mkdir(path.dirname(destPath), { recursive: true });
      await new Promise((resolve, reject) => {
        let settled = false;
        const settle = (fn, val) => { if (!settled) { settled = true; fn(val); } };

        // Count actual inflated bytes to catch zip-bombs that lie about uncompressedSize.
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

        // O_EXCL: fail if the file already exists (duplicate entries / TOCTOU hardening).
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

module.exports = {
  validateZipEntries,
  checkExtractedDir,
  extractToDir,
  isSymlinkZipEntry,
  IMPORT_MAX_UNCOMPRESSED,
  IMPORT_MAX_FILE_COUNT,
  DANGEROUS_EXTENSIONS,
};
