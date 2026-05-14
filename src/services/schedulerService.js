'use strict';

const scheduleModel = require('../models/scheduleModel');
const serverService = require('./serverService');

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
    try {
      serverService.sendCommand(s.server_id, s.command);
      scheduleModel.touch(s.id);
      console.log(`[scheduler] Ran "${s.name}" on server ${s.server_id}: ${s.command}`);
    } catch {
      // Server not running or stdin closed — skip silently this tick
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
