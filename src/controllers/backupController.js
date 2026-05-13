'use strict';

const serverModel   = require('../models/serverModel');
const backupService = require('../services/backupService');
const { notFound }  = require('../utils/errors');
const { securityLog } = require('../utils/securityLog');

function requireServer(id) {
  const server = serverModel.findById(id);
  if (!server) throw notFound(`Server '${id}' not found`);
  return server;
}

async function list(req, res, next) {
  try {
    const server  = requireServer(req.params.id);
    const backups = await backupService.listBackups(server.path);
    res.json({ data: backups });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const server = requireServer(req.params.id);
    const backup = await backupService.createBackup(req.params.id, server.path);
    res.status(201).json({ data: backup });
  } catch (err) {
    next(err);
  }
}

async function download(req, res, next) {
  try {
    const server = requireServer(req.params.id);
    await backupService.streamBackup(server.path, req.params.backupId, res);
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const server = requireServer(req.params.id);
    await backupService.deleteBackup(server.path, req.params.backupId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

async function restore(req, res, next) {
  const ip       = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  const userId   = req.user?.userId ?? null;
  const serverId = req.params.id;
  const backupId = req.params.backupId;
  try {
    const server = requireServer(serverId);
    securityLog('info', 'backup.restore.start', { ip, userId, serverId, backupId });
    await backupService.restoreBackup(serverId, backupId, server.path);
    securityLog('info', 'backup.restore.complete', { ip, userId, serverId, backupId });
    res.json({ data: { message: 'Restore completed successfully' } });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, download, remove, restore };
