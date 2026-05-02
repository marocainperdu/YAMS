'use strict';

const serverModel = require('../models/serverModel');
const jarService  = require('../services/jarService');
const { notFound, badRequest } = require('../utils/errors');

async function downloadJar(req, res, next) {
  try {
    const server = serverModel.findById(req.params.id);
    if (!server) return next(notFound('Server not found'));

    const { engine, version } = req.body;
    if (!engine)  return next(badRequest('engine is required'));
    if (!version) return next(badRequest('version is required'));

    await jarService.downloadJar(server.path, engine, version);
    res.json({ data: { success: true } });
  } catch (err) {
    next(err);
  }
}

module.exports = { downloadJar };
