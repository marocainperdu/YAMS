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

module.exports = { searchModpacks, getProjectVersions, downloadPackFile };
