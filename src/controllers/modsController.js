'use strict';

const fsp    = require('fs/promises');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const busboy = require('busboy');
const serverModel = require('../models/serverModel');
const modrinth    = require('../utils/modrinthClient');
const { notFound, badRequest } = require('../utils/errors');

// Maps YAMS engine names → Modrinth loader identifiers
const LOADER_MAP = {
  fabric: 'fabric', forge: 'forge', neoforge: 'neoforge', quilt: 'quilt',
  paper: 'paper', purpur: 'purpur', folia: 'folia', spigot: 'bukkit',
};

function modsDir(serverPath) { return path.join(serverPath, 'mods'); }

// Validate that filename is safe — no path separators, only .jar or .jar.disabled
function safeName(filename) {
  return typeof filename === 'string'
    && path.basename(filename) === filename
    && (filename.endsWith('.jar') || filename.endsWith('.jar.disabled'));
}

function requireServer(id) {
  const s = serverModel.findById(id);
  if (!s) throw notFound('Server not found');
  return s;
}

function sha512Stream(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function downloadTo(url, destPath) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? require('https') : require('http');
    mod.get(url, { headers: { 'User-Agent': 'YAMS/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return downloadTo(res.headers.location, destPath).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const out = fs.createWriteStream(destPath);
      res.pipe(out);
      out.on('finish', () => out.close(resolve));
      out.on('error', err => { fsp.unlink(destPath).catch(() => {}); reject(err); });
      res.on('error',  err => { fsp.unlink(destPath).catch(() => {}); reject(err); });
    }).on('error', reject);
  });
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async function list(req, res, next) {
  try {
    const server = requireServer(req.params.id);
    const dir = modsDir(server.path);

    let entries;
    try { entries = await fsp.readdir(dir); }
    catch { return res.json({ data: [] }); }

    const mods = [];
    for (const name of entries) {
      if (!safeName(name)) continue;
      try {
        const stat = await fsp.stat(path.join(dir, name));
        mods.push({ filename: name, enabled: name.endsWith('.jar'), size: stat.size, modifiedAt: stat.mtime.toISOString() });
      } catch { /* file vanished between readdir and stat */ }
    }
    mods.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.filename.localeCompare(b.filename));
    res.json({ data: mods });
  } catch (err) { next(err); }
}

async function scan(req, res, next) {
  try {
    const server = requireServer(req.params.id);
    const dir = modsDir(server.path);

    let entries;
    try { entries = await fsp.readdir(dir); }
    catch { return res.json({ data: {} }); }

    const jarFiles = entries.filter(n => safeName(n));
    if (!jarFiles.length) return res.json({ data: {} });

    // Hash each jar; build bidirectional map
    const filenameToHash = new Map();
    const hashes = [];
    for (const name of jarFiles) {
      try {
        const h = await sha512Stream(path.join(dir, name));
        filenameToHash.set(name, h);
        hashes.push(h);
      } catch { /* unreadable, skip */ }
    }

    const identified = await modrinth.identifyMods(hashes);

    const result = {};
    for (const name of jarFiles) {
      const hash = filenameToHash.get(name);
      const info = hash ? identified.get(hash) : null;
      result[name] = info ? { identified: true, ...info } : { identified: false };
    }

    res.json({ data: result });
  } catch (err) { next(err); }
}

async function prune(req, res, next) {
  try {
    const server = requireServer(req.params.id);
    const { filenames } = req.body;
    if (!Array.isArray(filenames) || !filenames.length) return next(badRequest('filenames must be a non-empty array'));

    const dir = modsDir(server.path);
    let deleted = 0;
    for (const name of filenames) {
      if (!safeName(name)) continue;
      try { await fsp.unlink(path.join(dir, name)); deleted++; } catch { /* already gone */ }
    }
    res.json({ data: { deleted } });
  } catch (err) { next(err); }
}

async function searchMods(req, res, next) {
  try {
    const server = requireServer(req.params.id);
    const { q } = req.query;
    if (!q?.trim()) return next(badRequest('q is required'));

    const loader = LOADER_MAP[server.engine?.toLowerCase()] ?? null;
    const result = await modrinth.searchMods(q.trim(), { loader, gameVersion: server.version || null });

    res.json({
      data: (result.hits ?? []).map(h => ({
        projectId:   h.project_id,
        title:       h.title,
        description: h.description,
        slug:        h.slug,
        iconUrl:     h.icon_url ?? null,
        downloads:   h.downloads,
        serverSide:  h.server_side,
        clientSide:  h.client_side,
      })),
    });
  } catch (err) { next(err); }
}

async function getVersions(req, res, next) {
  try {
    const server = requireServer(req.params.id);
    const loader = LOADER_MAP[server.engine?.toLowerCase()] ?? null;
    const versions = await modrinth.getModProjectVersions(req.params.projectId, {
      loader, gameVersion: server.version || null,
    });
    res.json({
      data: versions.map(v => ({
        id:            v.id,
        name:          v.name,
        versionNumber: v.version_number,
        gameVersions:  v.game_versions,
        loaders:       v.loaders,
        primaryFile:   v.files?.find(f => f.primary) ?? v.files?.[0] ?? null,
      })),
    });
  } catch (err) { next(err); }
}

async function install(req, res, next) {
  try {
    const server = requireServer(req.params.id);
    const { versionId } = req.body;
    if (!versionId) return next(badRequest('versionId is required'));

    const version = await modrinth.getVersion(versionId);
    const file = version.files?.find(f => f.primary) ?? version.files?.[0];
    if (!file?.url) return next(badRequest('No downloadable file for this version'));

    const dir = modsDir(server.path);
    await fsp.mkdir(dir, { recursive: true });
    const destPath = path.join(dir, file.filename);
    await downloadTo(file.url, destPath);

    const stat = await fsp.stat(destPath);
    res.json({ data: { filename: file.filename, size: stat.size } });
  } catch (err) { next(err); }
}

function upload(req, res, next) {
  const server = serverModel.findById(req.params.id);
  if (!server) return next(notFound('Server not found'));

  fsp.mkdir(modsDir(server.path), { recursive: true }).then(() => {
    const bb = busboy({ headers: req.headers, limits: { files: 1, fileSize: 200 * 1024 * 1024 } });
    let finalPath = null, tmpPath = null, fileErr = null, done = false;

    bb.on('file', (_, stream, info) => {
      const filename = path.basename(info.filename || '');
      if (!filename.endsWith('.jar')) {
        stream.resume();
        fileErr = badRequest('Only .jar files can be uploaded');
        return;
      }
      finalPath = path.join(modsDir(server.path), filename);
      tmpPath   = finalPath + '.uptmp';
      const ws = fs.createWriteStream(tmpPath);
      stream.on('limit', () => { stream.resume(); ws.destroy(); fsp.unlink(tmpPath).catch(() => {}); fileErr = badRequest('File exceeds 200 MB limit'); });
      stream.pipe(ws);
      ws.on('finish', () => { done = true; });
      ws.on('error',  err => { fileErr = err; fsp.unlink(tmpPath).catch(() => {}); });
    });

    bb.on('close', async () => {
      if (fileErr) return next(fileErr);
      if (!done || !finalPath) return next(badRequest('No file received'));
      try {
        await fsp.rename(tmpPath, finalPath);
        const stat = await fsp.stat(finalPath);
        res.json({ data: { filename: path.basename(finalPath), size: stat.size } });
      } catch (err) { next(err); }
    });

    bb.on('error', err => next(err));
    req.pipe(bb);
  }).catch(next);
}

async function toggle(req, res, next) {
  try {
    const server = requireServer(req.params.id);
    const { filename } = req.params;
    if (!safeName(filename)) return next(badRequest('Invalid filename'));

    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') return next(badRequest('enabled must be a boolean'));

    const dir = modsDir(server.path);
    const isEnabled = filename.endsWith('.jar') && !filename.endsWith('.jar.disabled');

    if (enabled === isEnabled) {
      const stat = await fsp.stat(path.join(dir, filename));
      return res.json({ data: { filename, enabled, size: stat.size, modifiedAt: stat.mtime.toISOString() } });
    }

    const newFilename = enabled
      ? filename.replace(/\.jar\.disabled$/, '.jar')
      : filename + '.disabled';

    await fsp.rename(path.join(dir, filename), path.join(dir, newFilename));
    const stat = await fsp.stat(path.join(dir, newFilename));
    res.json({ data: { filename: newFilename, enabled, size: stat.size, modifiedAt: stat.mtime.toISOString() } });
  } catch (err) { next(err); }
}

async function remove(req, res, next) {
  try {
    const server = requireServer(req.params.id);
    const { filename } = req.params;
    if (!safeName(filename)) return next(badRequest('Invalid filename'));

    try { await fsp.unlink(path.join(modsDir(server.path), filename)); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }

    res.status(204).end();
  } catch (err) { next(err); }
}

module.exports = { list, scan, prune, searchMods, getVersions, install, upload, toggle, remove };
