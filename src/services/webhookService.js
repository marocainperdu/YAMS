'use strict';

const crypto       = require('crypto');
const webhookModel = require('../models/webhookModel');
const serverModel  = require('../models/serverModel');

const VALID_EVENTS = ['server.start', 'server.stop', 'server.crash', 'server.alert'];
const TIMEOUT_MS   = 5_000;

const DISCORD_WEBHOOK_RE = /^https:\/\/discord(?:app)?\.com\/api\/webhooks\//i;

const DISCORD_EVENT = {
  'server.start': { emoji: '🟢', label: 'démarré',  color: 0x57F287 },
  'server.stop':  { emoji: '⚫', label: 'arrêté',   color: 0x95A5A6 },
  'server.crash': { emoji: '🔴', label: 'a crashé', color: 0xED4245 },
  'server.alert': { emoji: '🟡', label: 'alerte',   color: 0xFEE75C },
  'server.test':  { emoji: '🔵', label: 'test',     color: 0x5865F2 },
};

function buildDiscordPayload(payload) {
  const meta = DISCORD_EVENT[payload.event] ?? { emoji: '⚪', label: payload.event, color: 0x99AAB5 };
  const embed = {
    color:     meta.color,
    title:     `${meta.emoji} **${payload.serverName}** — ${meta.label}`,
    footer:    { text: 'YAMS' },
    timestamp: new Date(payload.timestamp ?? Date.now()).toISOString(),
    fields:    [],
  };

  if (payload.test) {
    embed.description = 'Ceci est un message de test envoyé depuis YAMS.';
  } else if (payload.message) {
    embed.description = payload.message;
  } else if (payload.event === 'server.alert' && payload.metric != null) {
    const metricLabel = payload.metric === 'tps' ? 'TPS' : 'RAM (MB)';
    const opLabel     = payload.operator === 'lt' ? '<' : '>';
    embed.description = `**${metricLabel}** ${opLabel} ${payload.threshold} — valeur actuelle : **${
      typeof payload.value === 'number' ? payload.value.toFixed(1) : payload.value
    }**`;
  }

  return { username: 'YAMS', embeds: [embed] };
}

async function fire(hook, payload) {
  const isDiscord = DISCORD_WEBHOOK_RE.test(hook.url);
  const body      = isDiscord
    ? JSON.stringify(buildDiscordPayload(payload))
    : JSON.stringify(payload);

  const headers = { 'Content-Type': 'application/json' };

  if (!isDiscord) {
    headers['X-YAMS-Event']     = payload.event;
    headers['X-YAMS-Server-Id'] = payload.serverId;
    if (hook.secret) {
      const sig = crypto.createHmac('sha256', hook.secret).update(body).digest('hex');
      headers['X-YAMS-Signature'] = `sha256=${sig}`;
    }
  }

  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res   = await fetch(hook.url, { method: 'POST', headers, body, signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`[webhooks] ${hook.url} responded ${res.status}: ${text}`);
    }
  } catch (err) {
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

module.exports = { init, fire, dispatch, VALID_EVENTS };
