'use strict';

/**
 * Modpack installation service.
 *
 * Downloads a modpack (.mrpack or CurseForge .zip), extracts it, installs the
 * appropriate mod loader via the existing jarDownloader, downloads all mods with
 * a concurrency limit of 5, copies overrides to the server directory, then marks
 * the server as ready.
 *
 * Progress is broadcast in real time via serverService.broadcastInstallEvent().
 */

const path     = require('path');
const fs       = require('fs');
const fsp      = require('fs/promises');
const { createWriteStream } = require('fs');

const serverModel  = require('../models/serverModel');
const jarDownloader = require('../utils/jarDownloader');
const modrinth     = require('../utils/modrinthClient');
const curseforge   = require('../utils/curseforgeClient');

const TMP_DIR         = process.env.YAMS_TMP_DIR || '/tmp/yams-packs';
const MOD_CONCURRENCY = 5;

// Populated lazily to avoid circular import (modpackService ↔ serverService)
let _broadcastInstallEvent;
let _clearInstallClients;

function getBroadcast() {
  if (!_broadcastInstallEvent) {
    const ss = require('./serverService');
    _broadcastInstallEvent = ss.broadcastInstallEvent;
    _clearInstallClients   = ss.clearInstallClients;
  }
  return { broadcastInstallEvent: _broadcastInstallEvent, clearInstallClients: _clearInstallClients };
}

// Map<serverId, { cancelled: boolean }>
const installingJobs = new Map();

// ── Helpers ──────────────────────────────────────────────────────────────────

function emit(serverId, msg) {
  const { broadcastInstallEvent } = getBroadcast();
  broadcastInstallEvent(serverId, { timestamp: Date.now(), ...msg });
}

function isCancelled(serverId) {
  return installingJobs.get(serverId)?.cancelled === true;
}

/**
 * Download a file from url to destPath, following redirects.
 * Re-implements the minimal downloader here so modpackService has no
 * dependency on jarDownloader's internal helpers.
 */
function downloadFileTo(url, destPath) {
  return new Promise((resolve, reject) => {
    const httpsMod = require('https');
    const httpMod  = require('http');
    const get = url.startsWith('https') ? httpsMod.get : httpMod.get;
    get(url, { headers: { 'User-Agent': 'YAMS/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return downloadFileTo(res.headers.location, destPath).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
      }
      const file = createWriteStream(destPath);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', err => { fs.unlink(destPath, () => {}); reject(err); });
      res.on('error',  err => { fs.unlink(destPath, () => {}); reject(err); });
    }).on('error', err => { fs.unlink(destPath, () => {}); reject(err); });
  });
}

/**
 * Extract a ZIP/mrpack file using Node's built-in streams.
 * Requires the `yauzl` package. Extracts all entries to outDir.
 */
async function extractZip(zipPath, outDir) {
  await fsp.mkdir(outDir, { recursive: true });
  const yauzl = require('yauzl');
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipFile) => {
      if (err) return reject(err);
      zipFile.readEntry();
      zipFile.on('entry', entry => {
        const entryPath = path.join(outDir, entry.fileName);
        if (/\/$/.test(entry.fileName)) {
          // Directory
          fsp.mkdir(entryPath, { recursive: true })
            .then(() => zipFile.readEntry())
            .catch(reject);
        } else {
          fsp.mkdir(path.dirname(entryPath), { recursive: true })
            .then(() => {
              zipFile.openReadStream(entry, (err2, readStream) => {
                if (err2) return reject(err2);
                const ws = createWriteStream(entryPath);
                readStream.pipe(ws);
                ws.on('finish', () => zipFile.readEntry());
                ws.on('error', reject);
                readStream.on('error', reject);
              });
            })
            .catch(reject);
        }
      });
      zipFile.on('end', resolve);
      zipFile.on('error', reject);
    });
  });
}

/**
 * Copy a directory tree from src to dest, creating dirs as needed.
 */
async function copyDir(src, dest) {
  await fsp.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath  = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fsp.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Run N async tasks with a concurrency limit.
 * @param {Array<() => Promise<any>>} tasks
 * @param {number} concurrency
 */
async function runConcurrent(tasks, concurrency) {
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      const task = tasks[i++];
      await task();
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
}

// ── Manifest parsers ─────────────────────────────────────────────────────────

/**
 * Parse a Modrinth modrinth.index.json and return a normalised descriptor.
 * @returns {{ mcVersion, loader, loaderVersion, files: [{path, url}] }}
 */
function parseModrinthManifest(manifest) {
  const deps = manifest.dependencies ?? {};
  const mcVersion = deps.minecraft;
  if (!mcVersion) throw new Error('modrinth.index.json is missing dependencies.minecraft');

  let loader = null;
  let loaderVersion = null;
  for (const [key, ver] of Object.entries(deps)) {
    if (key === 'minecraft') continue;
    loader = key;           // e.g. 'fabric-loader', 'neoforge', 'forge', 'quilt-loader'
    loaderVersion = ver;
    break;
  }

  const files = (manifest.files ?? []).map(f => ({
    path: f.path,
    url: (f.downloads ?? [])[0] ?? null,
  })).filter(f => f.url);

  return { mcVersion, loader, loaderVersion, files };
}

/**
 * Parse a CurseForge manifest.json and return a normalised descriptor.
 * @returns {{ mcVersion, loaderTag, files: [{projectId, fileId}] }}
 */
function parseCurseForgeManifest(manifest) {
  const mcVersion = manifest.minecraft?.version;
  if (!mcVersion) throw new Error('CurseForge manifest.json is missing minecraft.version');

  const loaderTag = manifest.minecraft?.modLoaders?.[0]?.id ?? null; // e.g. 'fabric-0.16.9'

  const files = (manifest.files ?? []).map(f => ({
    projectId: f.projectID,
    fileId:    f.fileID,
  }));

  return { mcVersion, loaderTag, files };
}

/**
 * Map a Modrinth loader key to the engine name used by jarDownloader.
 */
function modrinthLoaderToEngine(loader) {
  switch (loader) {
    case 'fabric-loader':  return 'fabric';
    case 'quilt-loader':   return 'fabric'; // Quilt is Fabric-compatible for server jar
    case 'neoforge':       return 'neoforge';
    case 'forge':          return 'forge';
    default:               return null;
  }
}

/**
 * Parse a CurseForge loader tag (e.g. 'fabric-0.16.9', 'forge-52.0.10') to engine name.
 */
function cfLoaderTagToEngine(tag) {
  if (!tag) return null;
  if (tag.startsWith('fabric'))   return 'fabric';
  if (tag.startsWith('neoforge')) return 'neoforge';
  if (tag.startsWith('forge'))    return 'forge';
  if (tag.startsWith('quilt'))    return 'fabric';
  return null;
}

// ── Main install orchestrator ─────────────────────────────────────────────────

/**
 * Install a modpack into the given server directory asynchronously.
 * Called as a fire-and-forget from serverService — does NOT await from the caller.
 *
 * @param {object} server           DB server record (must have id, path)
 * @param {object} packInfo
 * @param {string} packInfo.platform        'modrinth' | 'curseforge'
 * @param {string} packInfo.versionFileUrl  Direct download URL for the pack archive
 * @param {string} packInfo.versionName     Human-readable version string (for logging)
 */
async function installPack(server, packInfo) {
  const { id, path: serverPath } = server;
  const { platform, versionFileUrl, versionName } = packInfo;

  installingJobs.set(id, { cancelled: false });
  const tmpPackDir = path.join(TMP_DIR, id);
  const ext        = platform === 'curseforge' ? '.zip' : '.mrpack';
  const tmpZip     = path.join(TMP_DIR, `${id}${ext}`);

  try {
    await fsp.mkdir(TMP_DIR, { recursive: true });

    // ── Step 1: Download pack archive ────────────────────────────────────────
    emit(id, { type: 'install_progress', step: 'downloading_pack', message: `Downloading ${versionName}...` });
    await downloadFileTo(versionFileUrl, tmpZip);
    if (isCancelled(id)) return await doCancel(id, server, tmpZip, tmpPackDir);

    // ── Step 2: Extract archive ───────────────────────────────────────────────
    emit(id, { type: 'install_progress', step: 'extracting', message: 'Extracting modpack archive...' });
    await extractZip(tmpZip, tmpPackDir);
    if (isCancelled(id)) return await doCancel(id, server, tmpZip, tmpPackDir);

    // ── Step 3: Parse manifest ───────────────────────────────────────────────
    let descriptor;
    if (platform === 'modrinth') {
      const manifestPath = path.join(tmpPackDir, 'modrinth.index.json');
      const raw = await fsp.readFile(manifestPath, 'utf8');
      descriptor = parseModrinthManifest(JSON.parse(raw));
    } else {
      const manifestPath = path.join(tmpPackDir, 'manifest.json');
      const raw = await fsp.readFile(manifestPath, 'utf8');
      const cfManifest = parseCurseForgeManifest(JSON.parse(raw));
      descriptor = cfManifest;
    }

    // ── Step 4: Install mod loader ────────────────────────────────────────────
    let engine;
    if (platform === 'modrinth') {
      engine = modrinthLoaderToEngine(descriptor.loader);
    } else {
      engine = cfLoaderTagToEngine(descriptor.loaderTag);
    }

    if (!engine) {
      throw new Error(`Unsupported mod loader: ${descriptor.loader ?? descriptor.loaderTag ?? 'unknown'}`);
    }

    const loaderLabel = descriptor.loader ?? descriptor.loaderTag ?? engine;
    emit(id, { type: 'install_progress', step: 'installing_loader', message: `Installing ${loaderLabel} for Minecraft ${descriptor.mcVersion}...` });
    await jarDownloader.downloadServerJar(serverPath, engine, descriptor.mcVersion);
    if (isCancelled(id)) return await doCancel(id, server, tmpZip, tmpPackDir);

    // ── Step 5: Create mods directory ─────────────────────────────────────────
    await fsp.mkdir(path.join(serverPath, 'mods'), { recursive: true });

    // ── Step 6: Resolve mod download URLs (CurseForge needs batch API lookup) ─
    let modFiles; // Array of { destRelPath, url, name }
    const skippedMods = [];

    if (platform === 'modrinth') {
      modFiles = descriptor.files.map(f => ({
        destRelPath: f.path,
        url: f.url,
        name: path.basename(f.path),
      }));
    } else {
      emit(id, { type: 'install_progress', step: 'resolving_mods', message: 'Resolving mod download URLs...' });
      const fileIds = descriptor.files.map(f => f.fileId);
      const resolved = await curseforge.getFileDownloadUrls(fileIds);
      const urlMap = new Map(resolved.map(f => [f.id, f]));

      modFiles = [];
      for (const { fileId, projectId } of descriptor.files) {
        const info = urlMap.get(fileId);
        if (!info?.downloadUrl) {
          const label = info?.fileName ?? info?.displayName ?? `project ${projectId}`;
          skippedMods.push(label);
          continue;
        }
        modFiles.push({
          destRelPath: path.join('mods', info.fileName),
          url: info.downloadUrl,
          name: info.fileName,
        });
      }
    }

    // ── Step 7: Download mods with concurrency limit ──────────────────────────
    const total = modFiles.length;
    let current = 0;

    const tasks = modFiles.map(mod => async () => {
      if (isCancelled(id)) return;
      const destPath = path.join(serverPath, mod.destRelPath);
      await fsp.mkdir(path.dirname(destPath), { recursive: true });
      await downloadFileTo(mod.url, destPath);
      current++;
      emit(id, { type: 'install_progress', step: 'downloading_mods', current, total, name: mod.name });
    });

    if (isCancelled(id)) return await doCancel(id, server, tmpZip, tmpPackDir);
    emit(id, { type: 'install_progress', step: 'downloading_mods', current: 0, total, name: '' });
    await runConcurrent(tasks, MOD_CONCURRENCY);
    if (isCancelled(id)) return await doCancel(id, server, tmpZip, tmpPackDir);

    // ── Step 8: Copy overrides ────────────────────────────────────────────────
    const overridesDir = path.join(tmpPackDir, 'overrides');
    if (fs.existsSync(overridesDir)) {
      emit(id, { type: 'install_progress', step: 'copying_overrides', message: 'Copying overrides...' });
      await copyDir(overridesDir, serverPath);
    }

    // ── Step 9: Cleanup temp files ────────────────────────────────────────────
    await cleanup(tmpZip, tmpPackDir);

    // ── Step 10: Mark complete ────────────────────────────────────────────────
    serverModel.updateInstallResult(id, 'stopped', null);
    installingJobs.delete(id);

    const { clearInstallClients } = getBroadcast();
    emit(id, {
      type: 'install_complete',
      skippedMods: skippedMods.length > 0 ? skippedMods : undefined,
    });
    clearInstallClients(id);

    console.log(`[YAMS] Modpack installed successfully for server '${server.name}' (${total} mods)`);
    if (skippedMods.length > 0) {
      console.warn(`[YAMS] ${skippedMods.length} mod(s) skipped (distribution-restricted): ${skippedMods.join(', ')}`);
    }

  } catch (err) {
    console.error(`[YAMS] Modpack install failed for '${server.name}': ${err.message}`);
    await cleanup(tmpZip, tmpPackDir).catch(() => {});
    serverModel.updateInstallResult(id, 'install_failed', err.message);
    installingJobs.delete(id);

    const { clearInstallClients } = getBroadcast();
    emit(id, { type: 'install_error', message: err.message });
    clearInstallClients(id);
  }
}

/**
 * Signal an in-progress install to cancel.
 * The install job checks isCancelled() between batches; once it sees this flag
 * it calls doCancel() to clean up disk + DB.
 * @param {string} serverId
 */
function cancelInstall(serverId) {
  const job = installingJobs.get(serverId);
  if (job) job.cancelled = true;
}

/** @param {string} serverId */
function isInstalling(serverId) {
  return installingJobs.has(serverId);
}

// ── Private helpers ───────────────────────────────────────────────────────────

async function cleanup(zipPath, extractDir) {
  await fsp.rm(zipPath,     { force: true }).catch(() => {});
  await fsp.rm(extractDir,  { recursive: true, force: true }).catch(() => {});
}

async function doCancel(id, server, zipPath, extractDir) {
  await cleanup(zipPath, extractDir);
  await fsp.rm(server.path, { recursive: true, force: true }).catch(() => {});
  serverModel.remove(id);
  installingJobs.delete(id);

  const { clearInstallClients } = getBroadcast();
  emit(id, { type: 'install_cancelled' });
  clearInstallClients(id);
  console.log(`[YAMS] Modpack install cancelled for server '${server.name}'`);
}

module.exports = { installPack, cancelInstall, isInstalling };
