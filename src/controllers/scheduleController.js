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

function create(req, res, next) {
  try {
    if (!serverModel.findById(req.params.id)) return next(notFound('Server not found'));
    const { name, cron, command, enabled = true } = req.body;
    if (!name || typeof name !== 'string' || !name.trim())
      return next(badRequest('name is required'));
    if (!cron || !validateCron(cron))
      return next(badRequest('Invalid cron expression (expected: minute hour dom month dow)'));
    if (!command || typeof command !== 'string' || !command.trim())
      return next(badRequest('command is required'));
    const s = scheduleModel.create({
      id: uuidv4(), serverId: req.params.id,
      name: name.trim(), cron: cron.trim(), command: command.trim(), enabled,
    });
    res.status(201).json({ data: s });
  } catch (err) { next(err); }
}

function update(req, res, next) {
  try {
    const s = scheduleModel.findById(req.params.scheduleId);
    if (!s) return next(notFound('Schedule not found'));
    const { name, cron, command, enabled } = req.body;
    const nextName    = name    !== undefined ? String(name).trim()    : s.name;
    const nextCron    = cron    !== undefined ? String(cron).trim()    : s.cron;
    const nextCommand = command !== undefined ? String(command).trim() : s.command;
    const nextEnabled = enabled !== undefined ? !!enabled              : !!s.enabled;
    if (!nextName)    return next(badRequest('name is required'));
    if (!validateCron(nextCron)) return next(badRequest('Invalid cron expression'));
    if (!nextCommand) return next(badRequest('command is required'));
    const updated = scheduleModel.update(s.id, {
      name: nextName, cron: nextCron, command: nextCommand, enabled: nextEnabled,
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
