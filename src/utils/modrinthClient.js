'use strict';

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const BASE = 'https://api.modrinth.com/v2';
const UA   = 'YAMS/1.0 (github.com/momo/yams)';

// ── Simple 5-minute in-memory cache for search results ─────────────────────
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { cache.delete(key); return null; }
  return entry.value;
}

function cacheSet(key, value) {
  cache.set(key, { value, ts: Date.now() });
}

// ── HTTP helpers ────────────────────────────────────────────────────────────

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': UA } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return fetchJson(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Modrinth API returned ${res.statusCode} for ${url}`));
      }
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error('Failed to parse Modrinth response')); }
      });
    }).on('error', reject);
  });
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const get = url.startsWith('https') ? https.get : require('http').get;
    get(url, { headers: { 'User-Agent': UA } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return downloadFile(res.headers.location, destPath).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
      }
      const file = fs.createWriteStream(destPath);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', err => { fs.unlink(destPath, () => {}); reject(err); });
      res.on('error',  err => { fs.unlink(destPath, () => {}); reject(err); });
    }).on('error', err => { fs.unlink(destPath, () => {}); reject(err); });
  });
}

function postJson(apiPath, body) {
  const bodyStr = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.modrinth.com',
      path:     apiPath,
      method:   'POST',
      headers: {
        'User-Agent':     UA,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    }, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`Modrinth API ${res.statusCode} at ${apiPath}`));
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error('Failed to parse Modrinth response')); }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Search Modrinth for modpacks.
 * @param {string} query
 * @param {number} limit   Results per page (max 100)
 * @param {number} offset  Pagination offset
 * @returns {Promise<{ hits: object[], total_hits: number, offset: number, limit: number }>}
 */
async function searchModpacks(query, limit = 20, offset = 0) {
  const cacheKey = `search:${query}:${limit}:${offset}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const facets = JSON.stringify([['project_type:modpack']]);
  const index  = query ? 'relevance' : 'downloads';
  const url = `${BASE}/search?query=${encodeURIComponent(query)}&facets=${encodeURIComponent(facets)}&limit=${limit}&offset=${offset}&index=${index}`;
  const result = await fetchJson(url);
  cacheSet(cacheKey, result);
  return result;
}

/**
 * Get all available versions for a Modrinth project.
 * Returns only server-compatible loaders (fabric, forge, neoforge, quilt).
 * @param {string} projectId
 * @returns {Promise<object[]>}
 */
async function getProjectVersions(projectId) {
  const cacheKey = `versions:${projectId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const url = `${BASE}/project/${projectId}/version`;
  const versions = await fetchJson(url);
  cacheSet(cacheKey, versions);
  return versions;
}

/**
 * Download a modpack .mrpack file to a destination path.
 * @param {string} url       Direct CDN download URL from a version's files array
 * @param {string} destPath  Absolute path for the downloaded file
 */
async function downloadPackFile(url, destPath) {
  await downloadFile(url, destPath);
}

/**
 * Search Modrinth for individual mods (not modpacks).
 * @param {string} query
 * @param {{ loader?: string, gameVersion?: string }} opts
 * @param {number} limit
 */
async function searchMods(query, { loader, gameVersion } = {}, limit = 20) {
  const facets = [['project_type:mod']];
  if (loader)      facets.push([`categories:${loader}`]);
  if (gameVersion) facets.push([`versions:${gameVersion}`]);

  const url = `${BASE}/search?query=${encodeURIComponent(query)}&facets=${encodeURIComponent(JSON.stringify(facets))}&limit=${limit}&index=relevance`;
  return fetchJson(url);
}

/**
 * Get versions for a mod project, optionally filtered by loader and game version.
 * @param {string} projectId
 * @param {{ loader?: string, gameVersion?: string }} opts
 */
async function getModProjectVersions(projectId, { loader, gameVersion } = {}) {
  const qs = new URLSearchParams();
  if (loader)      qs.set('loaders',       JSON.stringify([loader]));
  if (gameVersion) qs.set('game_versions', JSON.stringify([gameVersion]));
  const suffix = qs.toString() ? `?${qs}` : '';
  return fetchJson(`${BASE}/project/${encodeURIComponent(projectId)}/version${suffix}`);
}

/**
 * Fetch a single version by ID.
 * @param {string} versionId
 */
async function getVersion(versionId) {
  return fetchJson(`${BASE}/version/${encodeURIComponent(versionId)}`);
}

/**
 * Identify local mod files by their SHA-512 hashes.
 * Returns a Map<hash, { projectId, title, slug, serverSide, clientSide, versionId, versionNumber }>.
 * Hashes not found on Modrinth are absent from the Map.
 * @param {string[]} hashes  SHA-512 hex strings
 */
async function identifyMods(hashes) {
  if (!hashes.length) return new Map();

  // Step 1: resolve hashes → version objects
  const versionMap = await postJson('/v2/version_files', { hashes, algorithm: 'sha512' });

  const versions = Object.values(versionMap);
  const projectIds = [...new Set(versions.map(v => v.project_id))];
  if (!projectIds.length) return new Map();

  // Step 2: fetch project metadata (includes server_side / client_side)
  const projects = await fetchJson(`${BASE}/projects?ids=${encodeURIComponent(JSON.stringify(projectIds))}`);
  const projectMap = new Map(projects.map(p => [p.id, p]));

  const result = new Map();
  for (const [hash, v] of Object.entries(versionMap)) {
    const p = projectMap.get(v.project_id);
    result.set(hash, {
      projectId:     v.project_id,
      versionId:     v.id,
      versionNumber: v.version_number,
      title:         p?.title     ?? null,
      slug:          p?.slug      ?? null,
      serverSide:    p?.server_side ?? null,
      clientSide:    p?.client_side ?? null,
    });
  }
  return result;
}

module.exports = { searchModpacks, getProjectVersions, downloadPackFile, searchMods, getModProjectVersions, getVersion, identifyMods };
