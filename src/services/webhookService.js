'use strict';

const crypto       = require('crypto');
const webhookModel = require('../models/webhookModel');
const serverModel  = require('../models/serverModel');

const VALID_EVENTS = ['server.start', 'server.stop', 'server.crash', 'server.alert'];
const TIMEOUT_MS   = 5_000;

async function fire(hook, payload) {
  const body    = JSON.stringify(payload);
  const headers = {
    'Content-Type':   'application/json',
    'X-YAMS-Event':   payload.event,
    'X-YAMS-Server-Id': payload.serverId,
  };
  if (hook.secret) {
    const sig = crypto.createHmac('sha256', hook.secret).update(body).digest('hex');
    headers['X-YAMS-Signature'] = `sha256=${sig}`;
  }
  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    await fetch(hook.url, { method: 'POST', headers, body, signal: ctrl.signal });
    clearTimeout(timer);
  } catch (err) {
    // Delivery failure is non-fatal — log and move on
    console.warn(`[webhooks] Delivery failed for ${hook.url}: ${err.message}`);
  }
}

function dispatch(serverId, eventName, extra = {}, onlyIds = null) {
  let hooks;
  try {
    hooks = webhookModel
      .findByServer(serverId)
      .filter(h => h.enabled && h.events.split(',').includes(eventName));
  } catch {
    return;
  }
  // If a specific list of IDs is provided, restrict to those
  if (onlyIds && onlyIds.length > 0) {
    const idSet = new Set(onlyIds);
    hooks = hooks.filter(h => idSet.has(h.id));
  }
  if (!hooks.length) return;

  const server  = serverModel.findById(serverId);
  const payload = {
    event:      eventName,
    serverId,
    serverName: server?.name ?? serverId,
    timestamp:  Date.now(),
    ...extra,
  };

  for (const hook of hooks) {
    fire(hook, payload); // fire-and-forget, errors logged in fire()
  }
}

function init() {
  // Lazy-require to avoid circular dependency at module load time
  const { streamEmitter, CRASH_CLASSIFY } = require('./serverService');

  streamEmitter.on('status', ({ serverId, state }) => {
    if (state === 'started')                         dispatch(serverId, 'server.start');
    else if (state === CRASH_CLASSIFY.NORMAL_STOP)   dispatch(serverId, 'server.stop');
    else if (
      state === CRASH_CLASSIFY.UNEXPECTED_CRASH ||
      state === CRASH_CLASSIFY.STARTUP_FAILURE
    )                                                dispatch(serverId, 'server.crash');
  });

  console.log('[webhooks] Initialized.');
}

module.exports = { init, VALID_EVENTS };
