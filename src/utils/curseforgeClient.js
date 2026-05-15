'use strict';

const https = require('https');
const fs    = require('fs');

const BASE        = 'https://api.curseforge.com/v1';
const UA          = 'YAMS/1.0 (github.com/momo/yams)';
const MINECRAFT_GAME_ID = 432;
const MODPACK_CLASS_ID  = 4471;

// ── Simple 5-minute in-memory cache ─────────────────────────────────────────
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

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function cfRequest(method, path, body) {
  const apiKey = process.env.CURSEFORGE_API_KEY;
  if (!apiKey) throw new Error('CURSEFORGE_API_KEY is not set');

  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const options = {
      hostname: 'api.curseforge.com',
      path,
      method,
      headers: {
        'User-Agent': UA,
        'x-api-key': apiKey,
        'Accept': 'application/json',
        ...(bodyStr && { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }),
      },
    };

    const req = https.request(options, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          let detail = '';
          try { detail = JSON.parse(raw)?.message ?? raw.slice(0, 200); } catch { detail = raw.slice(0, 200); }
          const err = new Error(`CurseForge API ${res.statusCode}: ${detail || path}`);
          err.statusCode = res.statusCode;
          return reject(err);
        }
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error('Failed to parse CurseForge response')); }
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
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

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Search CurseForge for modpacks.
 * Requires CURSEFORGE_API_KEY to be set.
 * @param {string} query
 * @param {number} pageSize
 * @param {number} index    Pagination index (0-based)
 * @returns {Promise<{ data: object[], pagination: object }>}
 */
async function searchModpacks(query, pageSize = 20, index = 0) {
  const cacheKey = `cf:search:${query}:${pageSize}:${index}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  // sortField 6 = TotalDownloads; sortOrder desc puts most-downloaded first
  const result = await cfRequest(
    'GET',
    `/v1/mods/search?gameId=${MINECRAFT_GAME_ID}&classId=${MODPACK_CLASS_ID}&searchFilter=${encodeURIComponent(query)}&pageSize=${pageSize}&index=${index}&sortField=6&sortOrder=desc`
  );
  cacheSet(cacheKey, result);
  return result;
}

/**
 * Get all file versions for a CurseForge mod/modpack.
 * @param {number} modId
 * @returns {Promise<object[]>}
 */
async function getPackVersions(modId) {
  const cacheKey = `cf:versions:${modId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const result = await cfRequest('GET', `/v1/mods/${modId}/files`);
  const versions = result.data ?? [];
  cacheSet(cacheKey, versions);
  return versions;
}

/**
 * Batch-resolve download URLs for a list of file IDs.
 * Uses a single API call instead of one per mod — critical for large packs.
 * Files that lack a downloadUrl (distribution-restricted) are returned with downloadUrl=null.
 * @param {number[]} fileIds
 * @returns {Promise<object[]>}  Array of file objects with downloadUrl (may be null)
 */
async function getFileDownloadUrls(fileIds) {
  if (!fileIds.length) return [];
  const result = await cfRequest('POST', '/v1/mods/files', { fileIds });
  return result.data ?? [];
}

/**
 * Batch-fetch mod details and return a map of projectId → websiteUrl.
 * Used to build exact file download page URLs for distribution-restricted mods.
 * @param {number[]} projectIds
 * @returns {Promise<Map<number, string>>}
 */
async function getModPageUrls(projectIds) {
  if (!projectIds.length) return new Map();
  const result = await cfRequest('POST', '/v1/mods', { modIds: projectIds });
  const map = new Map();
  for (const mod of result.data ?? []) {
    if (mod.links?.websiteUrl) map.set(mod.id, mod.links.websiteUrl);
  }
  return map;
}

/**
 * Download a CurseForge modpack zip file.
 * @param {string} url
 * @param {string} destPath
 */
async function downloadPackFile(url, destPath) {
  await downloadFile(url, destPath);
}

/** @returns {boolean} Whether CurseForge support is enabled (API key set) */
function isEnabled() {
  return Boolean(process.env.CURSEFORGE_API_KEY);
}

module.exports = { searchModpacks, getPackVersions, getFileDownloadUrls, getModPageUrls, downloadPackFile, isEnabled };
