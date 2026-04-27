'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const serverModel = require('../models/serverModel');

// Lazily required to avoid circular dependency (serverService → metricsService would be circular).
// We call require() inside init() and getServerMetrics(), not at module top-level.
let _streamEmitter = null;
let _sendCommand = null;
let _getMetricsSnapshot = null;

function _requireServerService() {
  if (_streamEmitter) return;
  const svc = require('./serverService');
  _streamEmitter = svc.streamEmitter;
  _sendCommand = svc.sendCommand;
  _getMetricsSnapshot = svc.getMetricsSnapshot;
}

// ─── In-memory caches ────────────────────────────────────────────────────────

// Map<serverId, { cpu: number|null, ramUsedMb: number|null, ramMaxMb: number|null, threads: number|null, sampledAt: number }>
const processCache = new Map();

// Map<serverId, { tps1m, tps5m, tps15m, available: true, updatedAt: number }>
const tpsCache = new Map();

// Map<serverId, { online: number, max: number }>
const playerCache = new Map();

// Map<serverId, { serverFolderMb, backupsMb, worldsMb, updatedAt: number }>
const diskCache = new Map();

// Map<serverId, NodeJS.Timeout> — one interval per running server
const samplerIntervals = new Map();

// Map<serverId, number> — epoch ms when first log line arrived (uptime approximation)
const serverUptimes = new Map();

// Map<serverId, number> — last time 'tps' command was sent (anti-spam)
const lastTpsCommand = new Map();

// Map<serverId, number> — last time 'list' command was sent
const lastListCommand = new Map();

// Set<serverId> — servers that have not responded to 'tps' within TPS_GIVE_UP_MS
const tpsUnavailable = new Set();

// ─── Constants ───────────────────────────────────────────────────────────────

const SAMPLER_INTERVAL_MS   = 5_000;   // Background CPU/RAM poll cadence
const TPS_ANTI_SPAM_MS      = 8_000;   // Min gap between 'tps' injections per server
const TPS_STALE_MS          = 30_000;  // TPS cache considered stale after 30 s
const TPS_GIVE_UP_MS        = 30_000;  // Stop trying tps if no response in 30 s
const DISK_CACHE_TTL_MS     = 60_000;  // Disk scan TTL

// ─── Regex ───────────────────────────────────────────────────────────────────

// Paper/Spigot: asterisk is optional (added when TPS is capped at 20)
const TPS_RE     = /TPS from last 1m, 5m, 15m: \*?([\d.]+), \*?([\d.]+), \*?([\d.]+)/;
const JOIN_RE_1  = /\w+\[.+\] logged in with entity id/;
const JOIN_RE_2  = /\]: \w+ joined the game/;
const LEAVE_RE_1 = /\]: \w+ left the game/;
const LEAVE_RE_2 = /\]: \w+ lost connection/;
const LIST_RE    = /There are (\d+) of a max of (\d+) players online/;
const DONE_RE    = /Done \([\d.]+s\)!/;

// ─── Pure parsing helpers (exported with _ prefix for unit tests) ─────────────

function _parseTps(line) {
  const m = TPS_RE.exec(line);
  if (!m) return null;
  return { tps1m: parseFloat(m[1]), tps5m: parseFloat(m[2]), tps15m: parseFloat(m[3]) };
}

function _parsePlayerEvent(line) {
  if (JOIN_RE_1.test(line) || JOIN_RE_2.test(line)) return 'join';
  if (LEAVE_RE_1.test(line) || LEAVE_RE_2.test(line)) return 'leave';
  return null;
}

function _parseListResponse(line) {
  const m = LIST_RE.exec(line);
  if (!m) return null;
  return { online: parseInt(m[1], 10), max: parseInt(m[2], 10) };
}

function _parseRamToMb(ramStr) {
  if (!ramStr) return null;
  const m = /^(\d+)(M|G)$/i.exec(ramStr);
  if (!m) return null;
  const val = parseInt(m[1], 10);
  return m[2].toUpperCase() === 'G' ? val * 1024 : val;
}

// ─── /proc helpers (Linux-only, graceful fallback on ENOENT/non-Linux) ────────

function _readProcStat(pid) {
  try {
    const parts = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(' ');
    return { utime: parseInt(parts[13], 10), stime: parseInt(parts[14], 10) };
  } catch {
    return null;
  }
}

function _readSysCpuTotal() {
  try {
    const line = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0];
    return line.split(/\s+/).slice(1).reduce((acc, v) => acc + parseInt(v, 10), 0);
  } catch {
    return null;
  }
}

function _readProcStatus(pid) {
  try {
    const content = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const rss     = content.match(/VmRSS:\s+(\d+)\s+kB/)?.[1];
    const threads = content.match(/Threads:\s+(\d+)/)?.[1];
    return {
      rssKb:   rss     ? parseInt(rss, 10)     : null,
      threads: threads ? parseInt(threads, 10) : null,
    };
  } catch {
    return null;
  }
}

// ─── Disk helpers ─────────────────────────────────────────────────────────────

async function _calcDirSize(dirPath) {
  let total = 0;
  try {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    const sizes = await Promise.all(entries.map(async (entry) => {
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) return _calcDirSize(full);
      if (entry.isFile()) {
        try { return (await fsp.stat(full)).size; } catch { return 0; }
      }
      return 0;
    }));
    total = sizes.reduce((a, b) => a + b, 0);
  } catch {
    // Missing directory or permission error — return 0
  }
  return total;
}

// ─── server.properties helpers ────────────────────────────────────────────────

async function _readMaxPlayers(serverPath) {
  const propsPath = path.join(serverPath, 'server.properties');
  try {
    const content = await fsp.readFile(propsPath, 'utf8');
    for (const raw of content.split('\n')) {
      const line = raw.replace(/\r$/, '');
      if (!line.includes('=') || line.trimStart().startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (line.slice(0, eq).trim() === 'max-players') {
        const val = parseInt(line.slice(eq + 1).trim(), 10);
        return isNaN(val) ? 20 : val;
      }
    }
  } catch {
    // file absent or unreadable — use Minecraft default
  }
  return 20;
}

async function _readLevelName(serverPath) {
  const propsPath = path.join(serverPath, 'server.properties');
  try {
    const content = await fsp.readFile(propsPath, 'utf8');
    for (const raw of content.split('\n')) {
      const line = raw.replace(/\r$/, '');
      if (!line.includes('=') || line.trimStart().startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (line.slice(0, eq).trim() === 'level-name') return line.slice(eq + 1);
    }
  } catch {
    // fall through to default
  }
  return 'world';
}

// ─── Disk metrics (with 60 s TTL cache) ────────────────────────────────────────

async function _getDiskMetrics(serverId, serverPath) {
  const cached = diskCache.get(serverId);
  if (cached && Date.now() - cached.updatedAt < DISK_CACHE_TTL_MS) {
    return { serverFolderMb: cached.serverFolderMb, backupsMb: cached.backupsMb, worldsMb: cached.worldsMb };
  }

  const toMb = (bytes) => Math.round(bytes / 1024 / 1024 * 10) / 10;

  const [totalBytes, backupBytes] = await Promise.all([
    _calcDirSize(serverPath),
    _calcDirSize(path.join(serverPath, 'backups')),
  ]);

  let worldsBytes = 0;
  try {
    const levelName = await _readLevelName(serverPath);
    const worldDirs = [levelName, `${levelName}_nether`, `${levelName}_the_end`];
    const sizes = await Promise.all(worldDirs.map(d => _calcDirSize(path.join(serverPath, d))));
    worldsBytes = sizes.reduce((a, b) => a + b, 0);
  } catch { /* non-critical */ }

  const result = {
    serverFolderMb: toMb(totalBytes),
    backupsMb:      toMb(backupBytes),
    worldsMb:       toMb(worldsBytes),
    updatedAt:      Date.now(),
  };
  diskCache.set(serverId, result);
  return { serverFolderMb: result.serverFolderMb, backupsMb: result.backupsMb, worldsMb: result.worldsMb };
}

// ─── TPS injection ─────────────────────────────────────────────────────────────

function _maybeInjectTps(serverId) {
  if (tpsUnavailable.has(serverId)) return;
  const now = Date.now();
  if (now - (lastTpsCommand.get(serverId) || 0) < TPS_ANTI_SPAM_MS) return;

  // Give up if server has been running > TPS_GIVE_UP_MS with no TPS response
  const uptime = serverUptimes.get(serverId);
  if (uptime && !tpsCache.has(serverId) && Date.now() - uptime > TPS_GIVE_UP_MS) {
    tpsUnavailable.add(serverId);
    return;
  }

  try {
    _sendCommand(serverId, 'tps');
    lastTpsCommand.set(serverId, now);
  } catch { /* server may have just stopped */ }
}

// ─── Background sampler ────────────────────────────────────────────────────────

function _startSampler(serverId) {
  if (samplerIntervals.has(serverId)) return;

  let prevProc  = null;
  let prevTotal = null;

  const tick = () => {
    const server = serverModel.findById(serverId);
    const pid = server?.pid;

    if (!pid) {
      processCache.set(serverId, { cpu: null, ramUsedMb: null, ramMaxMb: _parseRamToMb(server?.ram), threads: null, sampledAt: Date.now() });
      return;
    }

    const procStat = _readProcStat(pid);
    const sysTotal = _readSysCpuTotal();
    const procStatus = _readProcStatus(pid);

    let cpu = null;
    if (procStat && sysTotal !== null && prevProc !== null && prevTotal !== null) {
      const procDelta  = (procStat.utime + procStat.stime) - (prevProc.utime + prevProc.stime);
      const totalDelta = sysTotal - prevTotal;
      cpu = totalDelta > 0 ? Math.round((procDelta / totalDelta) * 100 * 100) / 100 : 0;
    }

    prevProc  = procStat;
    prevTotal = sysTotal;

    processCache.set(serverId, {
      cpu,
      ramUsedMb: procStatus?.rssKb ? Math.round(procStatus.rssKb / 1024 * 10) / 10 : null,
      ramMaxMb:  _parseRamToMb(server?.ram),
      threads:   procStatus?.threads ?? null,
      sampledAt: Date.now(),
    });

    _maybeInjectTps(serverId);
  };

  // Run immediately (first CPU sample — no delta yet, cpu will be null)
  tick();
  samplerIntervals.set(serverId, setInterval(tick, SAMPLER_INTERVAL_MS));
}

function _stopSampler(serverId) {
  const interval = samplerIntervals.get(serverId);
  if (interval) { clearInterval(interval); samplerIntervals.delete(serverId); }
  processCache.delete(serverId);
  playerCache.delete(serverId);
  tpsCache.delete(serverId);
  serverUptimes.delete(serverId);
  lastTpsCommand.delete(serverId);
  lastListCommand.delete(serverId);
  tpsUnavailable.delete(serverId);
  // diskCache is intentionally kept — disk data is valid even after stop
}

// ─── init() ────────────────────────────────────────────────────────────────────

function init() {
  _requireServerService();

  // Parse every stdout/stderr line for TPS, players, and server-ready signals.
  // Also lazily starts the sampler the first time a log arrives for a server.
  _streamEmitter.on('log', ({ serverId, data, timestamp }) => {
    const line = typeof data === 'string' ? data : '';

    // Lazy sampler start — fires as soon as the JVM produces its first line
    if (!samplerIntervals.has(serverId)) {
      _startSampler(serverId);
      if (!serverUptimes.has(serverId)) {
        serverUptimes.set(serverId, timestamp || Date.now());
      }
    }

    // TPS
    if (!tpsUnavailable.has(serverId)) {
      const tps = _parseTps(line);
      if (tps) {
        tpsCache.set(serverId, { ...tps, available: true, updatedAt: Date.now() });
      }
    }

    // Players (join / leave)
    const evt = _parsePlayerEvent(line);
    if (evt) {
      const current = playerCache.get(serverId) ?? { online: 0, max: 20 };
      const next = evt === 'join' ? current.online + 1 : Math.max(0, current.online - 1);
      playerCache.set(serverId, { ...current, online: next });
    }

    // 'list' command response → authoritative player count
    const listResult = _parseListResponse(line);
    if (listResult) {
      playerCache.set(serverId, { online: listResult.online, max: listResult.max });
    }

    // Server-ready: inject 'list' once and 'tps' once
    if (DONE_RE.test(line)) {
      const now = Date.now();
      if (now - (lastListCommand.get(serverId) || 0) > 5_000) {
        try { _sendCommand(serverId, 'list'); lastListCommand.set(serverId, now); } catch { /* non-critical */ }
      }
      if (!tpsUnavailable.has(serverId) && now - (lastTpsCommand.get(serverId) || 0) > TPS_ANTI_SPAM_MS) {
        try { _sendCommand(serverId, 'tps');  lastTpsCommand.set(serverId, now);  } catch { /* non-critical */ }
      }
    }
  });

  // Stop sampler and clear state when server process exits
  _streamEmitter.on('status', ({ serverId, state }) => {
    if (['normal', 'crashed', 'startup', 'stopping'].includes(state)) {
      _stopSampler(serverId);
    }
  });
}

// ─── getServerMetrics ─────────────────────────────────────────────────────────

async function getServerMetrics(serverId) {
  const server = serverModel.findById(serverId);
  if (!server) return null;

  _requireServerService(); // safe to call multiple times
  const isRunning = server.status === 'running';

  // ── Process metrics
  let processMetrics = null;
  if (isRunning) {
    const cached = processCache.get(serverId);
    processMetrics = {
      cpu:       cached?.cpu       ?? null,
      ramUsedMb: cached?.ramUsedMb ?? null,
      ramMaxMb:  cached?.ramMaxMb  ?? _parseRamToMb(server.ram),
      threads:   cached?.threads   ?? null,
      pid:       server.pid,
    };
  }

  // ── TPS
  let tpsData;
  if (!isRunning) {
    tpsData = { available: false, '1m': null, '5m': null, '15m': null };
  } else {
    const cached  = tpsCache.get(serverId);
    const isStale = !cached || Date.now() - cached.updatedAt > TPS_STALE_MS;
    const unavail = tpsUnavailable.has(serverId);
    tpsData = {
      available: !unavail && !isStale,
      '1m':  cached?.tps1m  ?? null,
      '5m':  cached?.tps5m  ?? null,
      '15m': cached?.tps15m ?? null,
    };
  }

  // ── Players
  const players   = playerCache.get(serverId) ?? { online: 0, max: 20 };
  const maxPlayers = await _readMaxPlayers(server.path);

  // ── World name
  let world = 'world';
  try { world = await _readLevelName(server.path); } catch { /* default */ }

  // ── Disk
  const disk = await _getDiskMetrics(serverId, server.path);

  // ── Uptime
  // Use getMetricsSnapshot() for the authoritative startedAt from the processes Map.
  // Falls back to our own serverUptimes if the snapshot doesn't have this server yet.
  let uptimeMs = 0;
  if (isRunning) {
    const snap = _getMetricsSnapshot();
    const snapServer = snap.serverList.find(s => s.id === serverId);
    uptimeMs = snapServer ? snapServer.uptime : (Date.now() - (serverUptimes.get(serverId) || Date.now()));
  }

  return {
    server: {
      id:     server.id,
      name:   server.name,
      status: server.status,
      port:   server.port,
      pid:    server.pid ?? null,
      uptime: uptimeMs,
    },
    process: processMetrics,
    minecraft: {
      tps: tpsData,
      players: {
        online: isRunning ? players.online : 0,
        max:    maxPlayers,
      },
      world,
    },
    disk,
    sampledAt: Date.now(),
  };
}

module.exports = {
  init,
  getServerMetrics,
  // Exported with underscore prefix for unit testing only
  _parseTps,
  _parsePlayerEvent,
  _parseListResponse,
  _parseRamToMb,
  _calcDirSize,
  _readMaxPlayers,
  _readProcStat,
  _readSysCpuTotal,
  _readProcStatus,
};
