'use strict';

/**
 * Request handlers (controllers) — kept intentionally thin.
 * Responsibility: parse request → call service → send response.
 * All errors are forwarded to Express's global error handler via next(err).
 */

const serverService = require('../services/serverService');

/**
 * POST /servers
 * Manual: { name, port, ram?, engine?, version?, maxPlayers?, motd?, gamemode?, pvp?, onlineMode? }
 * Modpack: { name, port, ram?, modpackPlatform, modpackProjectId, modpackVersionId,
 *            modpackVersionFileUrl, modpackVersionName? }
 */
async function create(req, res, next) {
  try {
    const {
      name, port, ram, engine, version, maxPlayers, motd, gamemode, pvp, onlineMode,
      modpackPlatform, modpackProjectId, modpackVersionId, modpackVersionFileUrl, modpackVersionName,
    } = req.body;
    const server = await serverService.createServer({
      name, port, ram, engine, version, maxPlayers, motd, gamemode, pvp, onlineMode,
      modpackPlatform, modpackProjectId, modpackVersionId, modpackVersionFileUrl, modpackVersionName,
    });
    res.status(201).json({ data: server });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /servers
 */
async function list(req, res, next) {
  try {
    const servers = serverService.listServers();
    res.json({ data: servers });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /servers/:id
 */
async function getOne(req, res, next) {
  try {
    const server = serverService.getServer(req.params.id);
    res.json({ data: server });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /servers/:id/start
 */
async function start(req, res, next) {
  try {
    const server = serverService.startServer(req.params.id);
    res.json({ data: server });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /servers/:id/stop
 */
async function stop(req, res, next) {
  try {
    const server = serverService.stopServer(req.params.id);
    res.json({ data: server });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /servers/:id
 */
async function remove(req, res, next) {
  try {
    await serverService.deleteServer(req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

/**
 * POST /servers/reorder
 * Body: { order: [id1, id2, ...] }
 */
function reorder(req, res, next) {
  try {
    const { order } = req.body;
    if (!Array.isArray(order) || order.length === 0)
      return next(require('../utils/errors').badRequest('order must be a non-empty array of server IDs'));
    require('../models/serverModel').reorder(order);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

/**
 * POST /servers/:id/cancel-install
 */
async function cancelInstall(req, res, next) {
  try {
    serverService.cancelInstallServer(req.params.id);
    res.status(202).json({ message: 'Installation cancellation requested' });
  } catch (err) {
    next(err);
  }
}

module.exports = { create, list, getOne, start, stop, remove, reorder, cancelInstall };
