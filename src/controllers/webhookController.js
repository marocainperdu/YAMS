'use strict';

const { v4: uuidv4 }         = require('uuid');
const webhookModel           = require('../models/webhookModel');
const serverModel            = require('../models/serverModel');
const { VALID_EVENTS, fire } = require('../services/webhookService');
const { badRequest, notFound } = require('../utils/errors');

function isValidUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseEvents(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  if (!raw.every(e => VALID_EVENTS.includes(e)))  return null;
  return [...new Set(raw)].join(',');
}

function list(req, res, next) {
  try {
    if (!serverModel.findById(req.params.id)) return next(notFound('Server not found'));
    const hooks = webhookModel.findByServer(req.params.id).map(format);
    res.json({ data: hooks });
  } catch (err) { next(err); }
}

function create(req, res, next) {
  try {
    if (!serverModel.findById(req.params.id)) return next(notFound('Server not found'));
    const { url, events, secret, enabled = true } = req.body;
    if (!url || !isValidUrl(url))
      return next(badRequest('url must be a valid http:// or https:// URL'));
    const eventsStr = parseEvents(events);
    if (!eventsStr)
      return next(badRequest(`events must be a non-empty array of: ${VALID_EVENTS.join(', ')}`));
    const hook = webhookModel.create({
      id: uuidv4(), serverId: req.params.id,
      url, events: eventsStr, secret: secret || null, enabled,
    });
    res.status(201).json({ data: format(hook) });
  } catch (err) { next(err); }
}

function update(req, res, next) {
  try {
    const hook = webhookModel.findById(req.params.webhookId);
    if (!hook) return next(notFound('Webhook not found'));
    const { url, events, secret, enabled } = req.body;
    const nextUrl     = url     !== undefined ? url     : hook.url;
    const nextSecret  = secret  !== undefined ? secret  : hook.secret;
    const nextEnabled = enabled !== undefined ? !!enabled : !!hook.enabled;
    const nextEvents  = events  !== undefined
      ? parseEvents(events)
      : hook.events;
    if (!isValidUrl(nextUrl))
      return next(badRequest('url must be a valid http:// or https:// URL'));
    if (!nextEvents)
      return next(badRequest(`events must be a non-empty array of: ${VALID_EVENTS.join(', ')}`));
    const updated = webhookModel.update(hook.id, {
      url: nextUrl, events: nextEvents, secret: nextSecret || null, enabled: nextEnabled,
    });
    res.json({ data: format(updated) });
  } catch (err) { next(err); }
}

function remove(req, res, next) {
  try {
    if (!webhookModel.findById(req.params.webhookId)) return next(notFound('Webhook not found'));
    webhookModel.remove(req.params.webhookId);
    res.status(204).end();
  } catch (err) { next(err); }
}

// Deserialize events string → array and strip secret from responses
function format(hook) {
  return {
    id:         hook.id,
    server_id:  hook.server_id,
    url:        hook.url,
    events:     hook.events.split(','),
    enabled:    !!hook.enabled,
    created_at: hook.created_at,
  };
}

async function test(req, res, next) {
  try {
    const hook = webhookModel.findById(req.params.webhookId);
    if (!hook) return next(notFound('Webhook not found'));
    const server = serverModel.findById(req.params.id);
    await fire(hook, {
      event:      'server.test',
      serverId:   hook.server_id,
      serverName: server?.name ?? hook.server_id,
      timestamp:  Date.now(),
      test:       true,
    });
    res.json({ data: { delivered: true } });
  } catch (err) { next(err); }
}

module.exports = { list, create, update, remove, test };
