'use strict';

const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const fsp    = require('fs').promises;
const path   = require('path');
const { spawn } = require('child_process');

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const get = url.startsWith('https') ? https.get : http.get;
    get(url, { headers: { 'User-Agent': 'YAMS/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return fetchText(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
      }
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => resolve(raw));
    }).on('error', reject);
  });
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const get = url.startsWith('https') ? https.get : http.get;
    get(url, { headers: { 'User-Agent': 'YAMS/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return fetchJson(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
      }
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error('Failed to parse JSON response')); }
      });
    }).on('error', reject);
  });
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const get = url.startsWith('https') ? https.get : http.get;
    get(url, { headers: { 'User-Agent': 'YAMS/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return downloadFile(res.headers.location, destPath).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} downloading JAR`));
      }
      const file = fs.createWriteStream(destPath);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', err => { fs.unlink(destPath, () => {}); reject(err); });
      res.on('error',  err => { fs.unlink(destPath, () => {}); reject(err); });
    }).on('error', err => { fs.unlink(destPath, () => {}); reject(err); });
  });
}

// ---------------------------------------------------------------------------
// Per-engine URL resolvers
// ---------------------------------------------------------------------------

async function getVanillaUrl(version) {
  const manifest = await fetchJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
  const entry = manifest.versions.find(v => v.id === version);
  if (!entry) throw new Error(`Vanilla version ${version} not found in Mojang manifest`);
  const meta = await fetchJson(entry.url);
  const url = meta.downloads?.server?.url;
  if (!url) throw new Error(`No server download available for Vanilla ${version}`);
  return url;
}

async function getPaperUrl(version) {
  const data = await fetchJson(`https://api.papermc.io/v2/projects/paper/versions/${version}/builds`);
  const builds = data.builds;
  if (!builds?.length) throw new Error(`No Paper builds found for ${version}`);
  const latest = builds[builds.length - 1];
  const jarName = latest.downloads?.application?.name;
  if (!jarName) throw new Error(`No application JAR in Paper build for ${version}`);
  return `https://api.papermc.io/v2/projects/paper/versions/${version}/builds/${latest.build}/downloads/${jarName}`;
}

async function getPurpurUrl(version) {
  const data = await fetchJson(`https://api.purpurmc.org/v2/purpur/${version}`);
  const build = data.builds?.latest;
  if (!build) throw new Error(`No Purpur builds found for ${version}`);
  return `https://api.purpurmc.org/v2/purpur/${version}/${build}/download`;
}

async function getFabricUrl(version) {
  const [loaders, installers] = await Promise.all([
    fetchJson('https://meta.fabricmc.net/v2/versions/loader'),
    fetchJson('https://meta.fabricmc.net/v2/versions/installer'),
  ]);
  const loader    = loaders[0]?.version;
  const installer = installers[0]?.version;
  if (!loader || !installer) throw new Error('Failed to resolve Fabric loader/installer versions');
  return `https://meta.fabricmc.net/v2/versions/loader/${version}/${loader}/${installer}/server/jar`;
}

async function installNeoForge(serverPath, mcVersion) {
  const parts = mcVersion.split('.');
  if (parts.length < 2) throw new Error(`Invalid MC version: ${mcVersion}`);
  const major = parseInt(parts[1], 10);
  const minor = parts.length >= 3 ? parseInt(parts[2], 10) : 0;

  if (major < 20 || (major === 20 && minor < 2)) {
    throw new Error(`NeoForge requires Minecraft 1.20.2 or newer (got ${mcVersion}). Use Fabric or Vanilla for older versions.`);
  }

  const prefix = `${major}.${minor}.`;
  const xml = await fetchText('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml');
  const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1]);
  const matching = versions.filter(v => v.startsWith(prefix));
  if (!matching.length) throw new Error(`No NeoForge release found for Minecraft ${mcVersion}`);
  const neoVersion = matching[matching.length - 1];

  const installerUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${neoVersion}/neoforge-${neoVersion}-installer.jar`;
  const installerPath = path.join(serverPath, 'neoforge-installer.jar');

  console.log(`[YAMS] Downloading NeoForge ${neoVersion} installer...`);
  await downloadFile(installerUrl, installerPath);

  console.log(`[YAMS] Running NeoForge installer (this may take a minute)...`);
  await new Promise((resolve, reject) => {
    const proc = spawn('java', ['-jar', 'neoforge-installer.jar', '--installServer'], {
      cwd: serverPath,
      stdio: 'inherit',
    });
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`NeoForge installer exited with code ${code}`));
    });
    proc.on('error', reject);
  });

  await fsp.unlink(installerPath).catch(() => {});
  console.log(`[YAMS] NeoForge ${neoVersion} installed for MC ${mcVersion}`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the download URL for the given engine + version, download the JAR,
 * and save it as `server.jar` inside serverPath.
 *
 * @param {string} serverPath  Absolute path to the server directory
 * @param {string} engine      'vanilla' | 'paper' | 'purpur' | 'fabric' | 'neoforge'
 * @param {string} version     Minecraft version string, e.g. '1.21.4'
 */
async function downloadServerJar(serverPath, engine, version) {
  if (engine === 'neoforge') {
    return installNeoForge(serverPath, version);
  }

  const destPath = path.join(serverPath, 'server.jar');
  let url;
  switch (engine) {
    case 'vanilla': url = await getVanillaUrl(version); break;
    case 'paper':   url = await getPaperUrl(version);   break;
    case 'purpur':  url = await getPurpurUrl(version);  break;
    case 'fabric':  url = await getFabricUrl(version);  break;
    case 'spigot':
      throw new Error(
        'Spigot requires BuildTools to compile from source (needs Git + Maven, ~20 min). ' +
        'Download the server JAR manually and upload it via the Files tab.'
      );
    default:
      throw new Error(`Unknown engine: ${engine}`);
  }

  console.log(`[YAMS] Downloading ${engine} ${version} from ${url}`);
  await downloadFile(url, destPath);
  console.log(`[YAMS] Downloaded server.jar for ${engine} ${version}`);
}

module.exports = { downloadServerJar };
