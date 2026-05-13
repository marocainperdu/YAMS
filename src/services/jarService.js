'use strict';

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const { badRequest } = require('../utils/errors');

const SUPPORTED = ['vanilla', 'paper', 'purpur'];

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function fetchJson(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    if (redirects <= 0) return reject(new Error('Too many redirects'));
    const proto = url.startsWith('https') ? https : http;
    const req = proto.get(url, { headers: { 'User-Agent': 'YAMS/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return fetchJson(res.headers.location, redirects - 1).then(resolve).catch(reject);
      }
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15_000, () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

// Downloads url → destPath via a .tmp file (atomic rename on completion).
function downloadFile(url, destPath, redirects = 5) {
  const tmp = destPath + '.tmp';
  return new Promise((resolve, reject) => {
    if (redirects <= 0) return reject(new Error('Too many redirects'));
    const proto = url.startsWith('https') ? https : http;
    const req = proto.get(url, { headers: { 'User-Agent': 'YAMS/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return downloadFile(res.headers.location, destPath, redirects - 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
      }
      const file = fs.createWriteStream(tmp);
      res.pipe(file);
      file.on('finish', () => {
        file.close(err => {
          if (err) { fs.unlink(tmp, () => {}); return reject(err); }
          fs.rename(tmp, destPath, err2 => {
            if (err2) { fs.unlink(tmp, () => {}); reject(err2); } else resolve();
          });
        });
      });
      file.on('error', err => { fs.unlink(tmp, () => {}); reject(err); });
    });
    req.on('error', err => { fs.unlink(tmp, () => {}); reject(err); });
    // 10-minute hard limit — large JARs on slow connections
    req.setTimeout(600_000, () => {
      req.destroy();
      fs.unlink(tmp, () => {});
      reject(new Error('Download timed out after 10 minutes'));
    });
  });
}

// ── Per-engine URL resolvers ──────────────────────────────────────────────────

async function getVanillaUrl(version) {
  const manifest = await fetchJson('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json');
  const entry = manifest.versions.find(v => v.id === version);
  if (!entry) throw badRequest(`Vanilla version "${version}" not found in Mojang manifest`);
  const meta = await fetchJson(entry.url);
  const url  = meta?.downloads?.server?.url;
  if (!url) throw badRequest(`No server JAR available for vanilla ${version}`);
  return url;
}

async function getPaperUrl(version) {
  const data   = await fetchJson(`https://api.papermc.io/v2/projects/paper/versions/${version}/builds`);
  const builds = data.builds;
  if (!builds || builds.length === 0) throw badRequest(`No Paper builds found for version ${version}`);
  const latest = builds[builds.length - 1];
  const jar    = latest.downloads.application.name;
  return `https://api.papermc.io/v2/projects/paper/versions/${version}/builds/${latest.build}/downloads/${jar}`;
}

function getPurpurUrl(version) {
  return `https://api.purpurmc.org/v2/purpur/${version}/latest/download`;
}

// ── Public API ────────────────────────────────────────────────────────────────

async function downloadJar(serverPath, engine, version) {
  if (!SUPPORTED.includes(engine)) {
    throw badRequest(
      `Automatic download is not supported for "${engine}". Place server.jar manually in the server directory.`
    );
  }

  let url;
  if      (engine === 'vanilla') url = await getVanillaUrl(version);
  else if (engine === 'paper')   url = await getPaperUrl(version);
  else                           url = getPurpurUrl(version);

  const dest = path.join(serverPath, 'server.jar');
  console.log(`[YAMS] Downloading ${engine} ${version} → ${dest}`);
  await downloadFile(url, dest);
  console.log(`[YAMS] JAR ready: ${dest}`);
}

module.exports = { downloadJar, SUPPORTED };
