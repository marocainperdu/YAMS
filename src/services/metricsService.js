'use strict';

const path = require('path');
const fsp  = require('fs/promises');
const os   = require('os');

const serverModel = require('../models/serverModel');

// ─── Platform guard ───────────────────────────────────────────────────────────
const IS_LINUX = os.platform() === 'linux';

// ─── Tuning constants ─────────────────────────────────────────────────────────
const DISK_CACHE_TTL     = 60_000;  // ms — recompute disk sizes every 60 s
const SAMPLE_INTERVAL_MS =  5_000;  // ms — CPU/RAM sample cadence
const TPS_TIMEOUT_MS     = 30_000;  // ms — mark TPS unavailable after no reply

// ─── Per-server in-memory caches ──────────────────────────────────────────────
/** serverId → { pid, cpu, ram, threads, sampledAt } */
const processCache = new Map();
/** serverId → { m1, m5, m15, available, updatedAt } */
const tpsCache     = new Map();
/** serverId → { online: Set<string>, max: number, updatedAt: number } */
const playerCache  = new Map();
/** serverId → { root, backups, worlds, sampledAt } */
const diskCache    = new Map();

// ─── Internal sampler state ───────────────────────────────────────────────────
const samplerIntervals = new Map();  // serverId → IntervalId
const tpsTimeouts      = new Map();  // serverId → TimeoutId
const prevCpuStats     = new Map();  // serverId → { utime, stime, total }
/** servers that have logged "Done (Xs)!" — i.e. fully started */
const serverDoneSet    = new Set();
/** in-flight disk scans: serverId → Promise — prevents concurrent scans */
const diskScans        = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// Pure parsers — exported for unit testing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse Paper/Spigot TPS from a log line.
 * "TPS from last 1m, 5m, 15m: 20.0, 20.0, 19.95"
 * @returns {{ m1: number, m5: number, m15: number } | null}
 */
function parseTps(line) {
  if (typeof line !== 'string') return null;
  const m = line.match(
    /TPS from last 1m, 5m, 15m:\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/
  );
  if (!m) return null;
  return { m1: parseFloat(m[1]), m5: parseFloat(m[2]), m15: parseFloat(m[3]) };
}

/**
 * Parse player join from a log line.
 * "Steve joined the game"
 * @returns {string | null} Player name, or null
 */
function parsePlayerJoin(line) {
  if (typeof line !== 'string') return null;
  const m = line.match(/^(.+) joined the game$/m);
  return m ? m[1].trim() : null;
}

/**
 * Parse player leave from a log line.
 * "Alex left the game"
 * @returns {string | null} Player name, or null
 */
function parsePlayerLeave(line) {
  if (typeof line !== 'string') return null;
  const m = line.match(/^(.+) left the game$/m);
  return m ? m[1].trim() : null;
}

/**
 * Parse the Minecraft /list command response.
 * "There are 2 of a max of 20 players online: ..."
 * @returns {{ online: number, max: number } | null}
 */
function parseListResponse(line) {
  if (typeof line !== 'string') return null;
  const m = line.match(/There are (\d+) of a max of (\d+) players online/);
  if (!m) return null;
  return { online: parseInt(m[1], 10), max: parseInt(m[2], 10) };
}

/**
 * Parse raw /proc/{pid}/status content into RSS and thread count.
 * @param {string} content
 * @returns {{ vmRss: number | null, threads: number | null }}
 */
function parseProcStatus(content) {
  let vmRss   = null;
  let threads = null;
  if (typeof content !== 'string') return { vmRss, threads };
  for (const line of content.split('\n')) {
    if (line.startsWith('VmRSS:')) {
      const m = line.match(/(\d+)\s*kB/i);
      if (m) vmRss = parseInt(m[1], 10) * 1024; // kB → bytes
    } else if (line.startsWith('Threads:')) {
      const m = line.match(/(\d+)/);
      if (m) threads = parseInt(m[1], 10);
    }
  }
  return { vmRss, threads };
}

// ─────────────────────────────────────────────────────────────────────────────
// /proc readers (Linux-only, return null on other OS)
// ─────────────────────────────────────────────────────────────────────────────

async function readProcStat(pid) {
  if (!IS_LINUX) return null;
  try {
    const content = await fsp.readFile(`/proc/${pid}/stat`, 'utf8');
    const parts   = content.split(' ');
    const utime   = parseInt(parts[13], 10);
    const stime   = parseInt(parts[14], 10);
    if (isNaN(utime) || isNaN(stime)) return null;
    return { utime, stime };
  } catch {
    return null;
  }
}

async function readGlobalCpu() {
  if (!IS_LINUX) return null;
  try {
    const content = await fsp.readFile('/proc/stat', 'utf8');
    const line    = content.split('\n')[0]; // "cpu  user nice system ..."
    const values  = line.split(/\s+/).slice(1).map(Number);
    return values.reduce((a, b) => a + b, 0);
  } catch {
    return null;
  }
}

async function readProcStatusFile(pid) {
  if (!IS_LINUX) return { vmRss: null, threads: null };
  try {
    const content = await fsp.readFile(`/proc/${pid}/status`, 'utf8');
    return parseProcStatus(content);
  } catch {
    return { vmRss: null, threads: null };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Directory size (exported for unit testing)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recursively sum byte sizes of all files under dirPath.
 * Skips symlinks to avoid infinite loops.
 * Returns 0 if the directory does not exist or cannot be read.
 */
async function dirSize(dirPath) {
  try {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    const sizes   = await Promise.all(
      entries.map((entry) => {
        if (entry.isSymbolicLink()) return 0;
        const full = path.join(dirPath, entry.name);
        if (entry.isDirectory()) return dirSize(full);
        return fsp.stat(full).then((s) => s.size).catch(() => 0);
      })
    );
    return sizes.reduce((acc, s) => acc + s, 0);
  } catch {
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Background CPU/RAM sampler
// ─────────────────────────────────────────────────────────────────────────────

function startSampler(serverId) {
  if (samplerIntervals.has(serverId)) return; // already running

  const id = setInterval(async () => {
    const server = serverModel.findById(serverId);
    if (!server || server.status !== 'running' || !server.pid) {
      stopSampler(serverId);
      return;
    }

    const pid = server.pid;
    const [procStat, globalTotal] = await Promise.all([
      readProcStat(pid),
      readGlobalCpu(),
    ]);

    let cpu = null;
    if (procStat && globalTotal !== null) {
      const prev = prevCpuStats.get(serverId);
      // First tick: store baseline, leave cpu = null
      if (prev) {
        const procDelta  = (procStat.utime + procStat.stime) - (prev.utime + prev.stime);
        const totalDelta = globalTotal - prev.total;
        // procDelta < 0 means PID was reused; totalDelta <= 0 is a clock oddity
        if (totalDelta > 0 && procDelta >= 0) {
          cpu = parseFloat(
            Math.min(100, (procDelta / totalDelta) * 100).toFixed(2)
          );
        }
      }
      prevCpuStats.set(serverId, {
        utime: procStat.utime,
        stime: procStat.stime,
        total: globalTotal,
      });
    }

    const { vmRss, threads } = await readProcStatusFile(pid);
    processCache.set(serverId, { pid, cpu, ram: vmRss, threads, sampledAt: Date.now() });
  }, SAMPLE_INTERVAL_MS);

  samplerIntervals.set(serverId, id);
}

function stopSampler(serverId) {
  const id = samplerIntervals.get(serverId);
  if (id !== undefined) {
    clearInterval(id);
    samplerIntervals.delete(serverId);
  }
  prevCpuStats.delete(serverId);
}

// ─────────────────────────────────────────────────────────────────────────────
// TPS polling
// ─────────────────────────────────────────────────────────────────────────────

function requestTps(serverId) {
  try {
    require('./serverService').sendCommand(serverId, 'tps');
  } catch {
    return; // server not running or stdin closed — ignore
  }

  const existing = tpsTimeouts.get(serverId);
  if (existing) clearTimeout(existing);

  // If no TPS log line arrives within TPS_TIMEOUT_MS, mark as unavailable
  const timer = setTimeout(() => {
    tpsTimeouts.delete(serverId);
    if (!tpsCache.get(serverId)?.available) {
      tpsCache.set(serverId, {
        m1: null, m5: null, m15: null, available: false, updatedAt: Date.now(),
      });
    }
  }, TPS_TIMEOUT_MS);

  tpsTimeouts.set(serverId, timer);
}

// ─────────────────────────────────────────────────────────────────────────────
// server.properties reader
// ─────────────────────────────────────────────────────────────────────────────

async function readServerProp(serverPath, key, defaultValue) {
  try {
    const content = await fsp.readFile(
      path.join(serverPath, 'server.properties'),
      'utf8'
    );
    for (const line of content.split('\n')) {
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      if (line.slice(0, eq).trim() === key) return line.slice(eq + 1);
    }
  } catch {}
  return defaultValue;
}

// ─────────────────────────────────────────────────────────────────────────────
// Disk metrics (60 s cache)
// ─────────────────────────────────────────────────────────────────────────────

const MINECRAFT_MARKERS = ['level.dat', 'region', 'data', 'DIM-1', 'DIM1'];

// Directories inside a server folder that are never world data — skip when
// looking for worlds and when counting server root size contributions.
const SKIP_DIRS = new Set(['backups', 'logs', 'crash-reports', 'cache', 'libraries']);

async function _runDiskScan(serverId) {
  const server = serverModel.findById(serverId);
  if (!server) return { root: 0, backups: 0, worlds: {}, sampledAt: Date.now() };

  const serverPath  = server.path;
  const backupsPath = path.join(serverPath, 'backups');

  // Detect world directories by Minecraft markers
  const worldsMap = {};
  try {
    const entries = await fsp.readdir(serverPath, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        if (!entry.isDirectory() || entry.isSymbolicLink()) return;
        if (entry.name.startsWith('.')) return; // skip hidden dirs
        if (SKIP_DIRS.has(entry.name)) return;
        const entryPath = path.join(serverPath, entry.name);
        for (const marker of MINECRAFT_MARKERS) {
          const ok = await fsp
            .access(path.join(entryPath, marker))
            .then(() => true)
            .catch(() => false);
          if (ok) {
            worldsMap[entry.name] = await dirSize(entryPath);
            return;
          }
        }
      })
    );
  } catch {}

  const [rootSize, backupsSize] = await Promise.all([
    dirSize(serverPath),
    dirSize(backupsPath),
  ]);

  const result = {
    root:      rootSize,
    backups:   backupsSize,
    worlds:    worldsMap,
    sampledAt: Date.now(),
  };
  diskCache.set(serverId, result);
  return result;
}

async function getDiskMetrics(serverId) {
  const cached = diskCache.get(serverId);
  if (cached && Date.now() - cached.sampledAt < DISK_CACHE_TTL) return cached;

  // Return the in-flight scan if one is already running for this server.
  // Prevents N concurrent HTTP requests from launching N parallel dir-walks.
  if (diskScans.has(serverId)) return diskScans.get(serverId);

  const scan = _runDiskScan(serverId);
  diskScans.set(serverId, scan);
  scan.finally(() => diskScans.delete(serverId));
  return scan;
}

// ─────────────────────────────────────────────────────────────────────────────
// streamEmitter event handlers
// ─────────────────────────────────────────────────────────────────────────────

function handleLog({ serverId, type, data }) {
  // Start sampler lazily on the first log line — avoids relying on unreliable
  // 'started' status event (only emitted when pending WS clients are present).
  startSampler(serverId);

  if (type === 'stderr') return; // skip stderr for game event parsing

  // Detect "Done (Xs)! For help..." — server is fully started
  if (!serverDoneSet.has(serverId) && /Done \([\d.]+s\)!/.test(data)) {
    serverDoneSet.add(serverId);
    try { require('./serverService').sendCommand(serverId, 'list'); } catch {}
    requestTps(serverId);
  }

  // TPS response from Paper/Spigot
  const tps = parseTps(data);
  if (tps) {
    const t = tpsTimeouts.get(serverId);
    if (t) { clearTimeout(t); tpsTimeouts.delete(serverId); }
    tpsCache.set(serverId, { ...tps, available: true, updatedAt: Date.now() });
  }

  // Ensure player cache entry exists
  if (!playerCache.has(serverId)) {
    playerCache.set(serverId, { online: new Set(), max: 20, updatedAt: Date.now() });
  }
  const pc = playerCache.get(serverId);

  const joined = parsePlayerJoin(data);
  if (joined) { pc.online.add(joined); pc.updatedAt = Date.now(); }

  const left = parsePlayerLeave(data);
  if (left)   { pc.online.delete(left); pc.updatedAt = Date.now(); }

  const listResult = parseListResponse(data);
  if (listResult) { pc.max = listResult.max; pc.updatedAt = Date.now(); }
}

function handleStatus({ serverId, state }) {
  // 'stopped' is included for forward-compatibility; current serverService
  // emits 'stopping' / 'normal' / 'crashed' / 'startup' for stop scenarios.
  const finalStates = new Set(['stopped', 'stopping', 'normal', 'crashed', 'startup']);
  if (finalStates.has(state)) {
    stopSampler(serverId);
    processCache.delete(serverId);
    tpsCache.delete(serverId);
    playerCache.delete(serverId);
    serverDoneSet.delete(serverId);
    const t = tpsTimeouts.get(serverId);
    if (t) { clearTimeout(t); tpsTimeouts.delete(serverId); }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return all metrics for a server. Returns null if the server does not exist.
 * @param {string} serverId
 * @returns {Promise<object | null>}
 */
async function getMetrics(serverId) {
  const server = serverModel.findById(serverId);
  if (!server) return null;

  const isRunning = server.status === 'running';

  // Process metrics — null when stopped or not yet sampled
  const procSnap = isRunning ? (processCache.get(serverId) || null) : null;
  const process_ = procSnap
    ? { pid: procSnap.pid, cpu: procSnap.cpu, ram: procSnap.ram, threads: procSnap.threads }
    : null;

  // TPS
  const tpsData = tpsCache.get(serverId);
  const tps = tpsData
    ? { m1: tpsData.m1, m5: tpsData.m5, m15: tpsData.m15, available: tpsData.available }
    : { m1: null, m5: null, m15: null, available: false };

  // Players — server.properties is ground truth for max-players
  const rawMax    = await readServerProp(server.path, 'max-players', '20');
  const maxFromProps = parseInt(rawMax, 10) || 20;
  const playerData   = playerCache.get(serverId);
  const players = {
    online: playerData ? playerData.online.size : 0,
    max:    playerData ? playerData.max : maxFromProps,
  };

  // World name
  const rawWorld  = await readServerProp(server.path, 'level-name', 'world');
  const worldName = rawWorld.trim() || 'world';

  // Disk
  const disk = await getDiskMetrics(serverId);

  // Uptime from serverService snapshot
  const snap       = require('./serverService').getMetricsSnapshot();
  const serverSnap = snap.serverList.find((s) => s.id === serverId);
  const uptime     = serverSnap ? serverSnap.uptime : 0;

  return {
    server: {
      id:     server.id,
      name:   server.name,
      status: server.status,
      port:   server.port,
      uptime,
    },
    process: process_,
    minecraft: {
      tps,
      players,
      world: worldName,
    },
    disk: {
      root:    disk.root,
      backups: disk.backups,
      worlds:  disk.worlds,
    },
    sampledAt: Date.now(),
  };
}

/**
 * Subscribe to streamEmitter events. Must be called once from app.js.
 */
function init() {
  const { streamEmitter } = require('./serverService');
  streamEmitter.on('log',    handleLog);
  streamEmitter.on('status', handleStatus);
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  init,
  getMetrics,
  getDiskMetrics,
  // Exported for unit testing
  parseTps,
  parsePlayerJoin,
  parsePlayerLeave,
  parseListResponse,
  parseProcStatus,
  dirSize,
};
