'use strict';

const scheduleModel = require('../models/scheduleModel');
const serverService = require('./serverService');
const serverModel   = require('../models/serverModel');
const backupService = require('./backupService');

// Supports: * (any), */N (every N steps), N (exact), N,M,... (list)
function matchField(field, value) {
  if (field === '*') return true;
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10);
    return !isNaN(step) && step > 0 && value % step === 0;
  }
  if (field.includes(',')) {
    return field.split(',').map(Number).includes(value);
  }
  const n = parseInt(field, 10);
  return !isNaN(n) && n === value;
}

function matchesCron(cronExpr, now) {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [m, h, dom, month, dow] = parts;
  return (
    matchField(m,     now.getMinutes()) &&
    matchField(h,     now.getHours())   &&
    matchField(dom,   now.getDate())    &&
    matchField(month, now.getMonth() + 1) &&
    matchField(dow,   now.getDay())
  );
}

// Returns true if cron expression is syntactically valid
function validateCron(expr) {
  if (typeof expr !== 'string') return false;
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  // [min, hour, dom, month, dow] — allowed ranges
  const ranges = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
  for (let i = 0; i < 5; i++) {
    const p = parts[i];
    if (p === '*') continue;
    if (/^\*\/\d+$/.test(p)) {
      const n = parseInt(p.slice(2), 10);
      if (n < 1) return false;
      continue;
    }
    const values = p.split(',').map(Number);
    if (values.some(isNaN)) return false;
    if (values.some(v => v < ranges[i][0] || v > ranges[i][1])) return false;
  }
  return true;
}

// Lazy-required to avoid circular dependency issues
function _requireMetricsService() {
  return require('./metricsService');
}

function _requireWebhookService() {
  return require('./webhookService');
}

async function _handleBackup(s, server) {
  const config = s.config || {};
  scheduleModel.touch(s.id);
  console.log(`[scheduler] Running backup task "${s.name}" on server ${s.server_id}`);
  try {
    await backupService.createBackup(s.server_id, server.path, { force: true });
    console.log(`[scheduler] Backup complete for server ${s.server_id}`);

    // Rotation: delete oldest backups beyond keep_last
    const keepLast = config.keep_last;
    if (keepLast && Number.isInteger(keepLast) && keepLast > 0) {
      const all = await backupService.listBackups(server.path); // sorted newest-first
      const toDelete = all.slice(keepLast);
      for (const b of toDelete) {
        await backupService.deleteBackup(server.path, b.id).catch(err =>
          console.warn(`[scheduler] Failed to delete old backup ${b.id}: ${err.message}`)
        );
      }
      if (toDelete.length > 0) {
        console.log(`[scheduler] Rotation: deleted ${toDelete.length} old backup(s) for server ${s.server_id}`);
      }
    }
  } catch (err) {
    console.error(`[scheduler] Backup failed for server ${s.server_id}: ${err.message}`);
  }
}

async function _handleRestart(s) {
  const config = s.config || {};
  const warnMin = Number.isInteger(config.warn_minutes) && config.warn_minutes > 0
    ? config.warn_minutes : 0;

  scheduleModel.touch(s.id);
  console.log(`[scheduler] Running restart task "${s.name}" on server ${s.server_id}`);

  try {
    if (warnMin > 0) {
      serverService.sendCommand(s.server_id, `say [YAMS] Server restarting in ${warnMin} minute(s)`);
      await new Promise(r => setTimeout(r, warnMin * 60_000));
    }
    serverService.stopServer(s.server_id);
    // Wait for process to fully exit before restarting
    setTimeout(() => {
      try {
        serverService.startServer(s.server_id);
        console.log(`[scheduler] Restart complete for server ${s.server_id}`);
      } catch (err) {
        console.error(`[scheduler] Restart (start phase) failed for server ${s.server_id}: ${err.message}`);
      }
    }, 5_000);
  } catch (err) {
    console.error(`[scheduler] Restart failed for server ${s.server_id}: ${err.message}`);
  }
}

async function _handleAlert(s) {
  const config = s.config || {};
  scheduleModel.touch(s.id);

  try {
    const metricsService = _requireMetricsService();
    const snap = await metricsService.getServerMetrics(s.server_id);
    if (!snap) return;

    let value;
    if (config.metric === 'tps') {
      value = snap.minecraft?.tps?.['1m'] ?? null;
    } else if (config.metric === 'ram') {
      value = snap.process?.ramUsedMb ?? null;
    }
    if (value == null) return; // server stopped or data not yet available

    const triggered = config.operator === 'lt'
      ? value < config.threshold
      : value > config.threshold;

    if (triggered) {
      const webhookService = _requireWebhookService();
      const onlyIds = Array.isArray(config.webhook_ids) && config.webhook_ids.length > 0
        ? config.webhook_ids : null;
      webhookService.dispatch(s.server_id, 'server.alert', {
        metric:    config.metric,
        value,
        threshold: config.threshold,
        operator:  config.operator,
      }, onlyIds);
      console.log(`[scheduler] Alert "${s.name}" triggered: ${config.metric}=${value} ${config.operator} ${config.threshold}`);
    }
  } catch (err) {
    console.error(`[scheduler] Alert task "${s.name}" error: ${err.message}`);
  }
}

function tick() {
  const now = new Date();
  let schedules;
  try {
    schedules = scheduleModel.findAllEnabled();
  } catch (err) {
    console.error('[scheduler] DB read error:', err.message);
    return;
  }

  for (const s of schedules) {
    if (!matchesCron(s.cron, now)) continue;
    const taskType = s.type || 'command';

    if (taskType === 'backup') {
      const server = serverModel.findById(s.server_id);
      if (!server) continue;
      _handleBackup(s, server);
    } else if (taskType === 'restart') {
      _handleRestart(s);
    } else if (taskType === 'alert') {
      _handleAlert(s);
    } else {
      // command
      try {
        serverService.sendCommand(s.server_id, s.command);
        scheduleModel.touch(s.id);
        console.log(`[scheduler] Ran "${s.name}" on server ${s.server_id}: ${s.command}`);
      } catch {
        // Server not running or stdin closed — skip silently this tick
      }
    }
  }
}

function init() {
  // Align to the next minute boundary so ticks happen at :00 seconds
  const now = new Date();
  const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 50;
  setTimeout(() => {
    tick();
    setInterval(tick, 60_000);
  }, msToNextMinute);
  console.log('[scheduler] Started.');
}

module.exports = { init, validateCron };
