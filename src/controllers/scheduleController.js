'use strict';

const { v4: uuidv4 }       = require('uuid');
const scheduleModel        = require('../models/scheduleModel');
const serverModel          = require('../models/serverModel');
const { validateCron }     = require('../services/schedulerService');
const { badRequest, notFound } = require('../utils/errors');

function list(req, res, next) {
  try {
    if (!serverModel.findById(req.params.id)) return next(notFound('Server not found'));
    res.json({ data: scheduleModel.findByServer(req.params.id) });
  } catch (err) { next(err); }
}

const VALID_TYPES = new Set(['command', 'backup', 'restart', 'alert']);

function validateConfig(type, config, next) {
  if (type === 'backup') {
    if (config.keep_last !== undefined) {
      if (!Number.isInteger(config.keep_last) || config.keep_last < 1)
        return next(badRequest('config.keep_last must be an integer ≥ 1'));
    }
  } else if (type === 'restart') {
    if (config.warn_minutes !== undefined) {
      if (!Number.isInteger(config.warn_minutes) || config.warn_minutes < 0)
        return next(badRequest('config.warn_minutes must be an integer ≥ 0'));
    }
  } else if (type === 'alert') {
    if (!['tps', 'ram'].includes(config.metric))
      return next(badRequest('config.metric must be "tps" or "ram"'));
    if (typeof config.threshold !== 'number' || isNaN(config.threshold))
      return next(badRequest('config.threshold must be a number'));
    if (!['lt', 'gt'].includes(config.operator))
      return next(badRequest('config.operator must be "lt" or "gt"'));
  }
  return null; // no error
}

function noCommandTypes() { return new Set(['backup', 'restart', 'alert']); }

function create(req, res, next) {
  try {
    if (!serverModel.findById(req.params.id)) return next(notFound('Server not found'));
    const { name, type = 'command', cron, command, config = {}, enabled = true } = req.body;
    if (!name || typeof name !== 'string' || !name.trim())
      return next(badRequest('name is required'));
    if (!VALID_TYPES.has(type))
      return next(badRequest('type must be one of: command, backup, restart, alert'));
    if (!cron || !validateCron(cron))
      return next(badRequest('Invalid cron expression (expected: minute hour dom month dow)'));
    if (type === 'command' && (!command || typeof command !== 'string' || !command.trim()))
      return next(badRequest('command is required for command tasks'));
    if (type === 'alert') {
      const err = validateConfig(type, config, next);
      if (err) return err;
    } else {
      const err = validateConfig(type, config, next);
      if (err) return err;
    }
    const s = scheduleModel.create({
      id: uuidv4(), serverId: req.params.id,
      name: name.trim(), type, cron: cron.trim(),
      command: noCommandTypes().has(type) ? '' : command.trim(),
      config,
      enabled,
    });
    res.status(201).json({ data: s });
  } catch (err) { next(err); }
}

function update(req, res, next) {
  try {
    const s = scheduleModel.findById(req.params.scheduleId);
    if (!s) return next(notFound('Schedule not found'));
    const { name, type, cron, command, config, enabled } = req.body;
    const nextName    = name    !== undefined ? String(name).trim()    : s.name;
    const nextType    = type    !== undefined ? String(type)           : (s.type || 'command');
    const nextCron    = cron    !== undefined ? String(cron).trim()    : s.cron;
    const nextCommand = command !== undefined ? String(command).trim() : s.command;
    const nextConfig  = config  !== undefined ? config                 : (s.config || {});
    const nextEnabled = enabled !== undefined ? !!enabled              : !!s.enabled;
    if (!nextName)    return next(badRequest('name is required'));
    if (!VALID_TYPES.has(nextType)) return next(badRequest('type must be one of: command, backup, restart, alert'));
    if (!validateCron(nextCron)) return next(badRequest('Invalid cron expression'));
    if (nextType === 'command' && !nextCommand) return next(badRequest('command is required for command tasks'));
    const cfgErr = validateConfig(nextType, nextConfig, next);
    if (cfgErr) return cfgErr;
    const updated = scheduleModel.update(s.id, {
      name: nextName, type: nextType, cron: nextCron,
      command: noCommandTypes().has(nextType) ? '' : nextCommand,
      config: nextConfig,
      enabled: nextEnabled,
    });
    res.json({ data: updated });
  } catch (err) { next(err); }
}

function remove(req, res, next) {
  try {
    if (!scheduleModel.findById(req.params.scheduleId)) return next(notFound('Schedule not found'));
    scheduleModel.remove(req.params.scheduleId);
    res.status(204).end();
  } catch (err) { next(err); }
}

module.exports = { list, create, update, remove };
