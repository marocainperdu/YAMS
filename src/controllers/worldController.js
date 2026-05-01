'use strict';

const serverModel  = require('../models/serverModel');
const worldService = require('../services/worldService');
const { notFound, badRequest } = require('../utils/errors');

function getServer(req) {
  const server = serverModel.findById(req.params.id);
  if (!server) throw notFound('Server not found', 'SERVER_NOT_FOUND');
  return server;
}

async function list(req, res, next) {
  try {
    const server = getServer(req);
    res.json(await worldService.listWorlds(server.path));
  } catch (err) { next(err); }
}

async function getOne(req, res, next) {
  try {
    const server = getServer(req);
    res.json(await worldService.getWorld(server.path, req.params.name));
  } catch (err) { next(err); }
}

async function setActive(req, res, next) {
  try {
    const server = getServer(req);
    const { name } = req.body ?? {};
    if (!name || typeof name !== 'string') {
      throw badRequest('Body field "name" is required', 'INVALID_WORLD_NAME');
    }
    res.json(await worldService.setActiveWorld(server.id, server.path, name));
  } catch (err) { next(err); }
}

async function remove(req, res, next) {
  try {
    const server = getServer(req);
    await worldService.deleteWorld(server.id, server.path, req.params.name);
    res.sendStatus(204);
  } catch (err) { next(err); }
}

async function importWorld(req, res, next) {
  try {
    const server = getServer(req);
    res.status(201).json(await worldService.importWorld(server.id, server.path, req));
  } catch (err) { next(err); }
}

async function exportWorld(req, res, next) {
  try {
    const server = getServer(req);
    await worldService.exportWorld(server.path, req.params.name, res);
  } catch (err) { next(err); }
}

module.exports = { list, getOne, setActive, remove, importWorld, exportWorld };
