'use strict';

const serverModel = require('../models/serverModel');
const fileService = require('../services/fileService');
const { notFound, badRequest } = require('../utils/errors');

function requireServer(id) {
  const server = serverModel.findById(id);
  if (!server) throw notFound(`Server '${id}' not found`);
  return server;
}

/** GET /servers/:id/files?path= */
async function list(req, res, next) {
  try {
    const server = requireServer(req.params.id);
    const result = await fileService.listDirectory(server.path, req.query.path || '');
    res.json(result);
  } catch (err) { next(err); }
}

/** GET /servers/:id/files/download?path= */
async function download(req, res, next) {
  try {
    const server = requireServer(req.params.id);
    const { stream, filename, contentType, size } = await fileService.downloadFile(
      server.path,
      req.query.path || ''
    );
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    if (size != null) res.setHeader('Content-Length', size);
    stream.pipe(res);
    stream.on('error', next);
  } catch (err) { next(err); }
}

/** POST /servers/:id/files/upload?path=&overwrite= */
async function upload(req, res, next) {
  try {
    const server = requireServer(req.params.id);
    const overwrite = req.query.overwrite === 'true';
    const result = await fileService.uploadFile(
      server.path,
      req.query.path || '',
      req,
      overwrite
    );
    res.status(201).json({ data: result });
  } catch (err) { next(err); }
}

/** POST /servers/:id/files/mkdir */
async function mkdir(req, res, next) {
  try {
    const server = requireServer(req.params.id);
    if (!req.body.path) return next(badRequest('path is required'));
    await fileService.createFolder(server.path, req.body.path);
    res.json({ data: { path: req.body.path } });
  } catch (err) { next(err); }
}

/** PUT /servers/:id/files/rename */
async function rename(req, res, next) {
  try {
    const server = requireServer(req.params.id);
    const { from, to } = req.body;
    if (!from || !to) return next(badRequest('Both from and to are required'));
    await fileService.renameFile(server.path, from, to);
    res.json({ data: { from, to } });
  } catch (err) { next(err); }
}

/** DELETE /servers/:id/files */
async function remove(req, res, next) {
  try {
    const server = requireServer(req.params.id);
    if (req.body.path === undefined || req.body.path === null) {
      return next(badRequest('path is required'));
    }
    await fileService.deleteFile(server.path, req.body.path);
    res.json({ data: { deleted: req.body.path } });
  } catch (err) { next(err); }
}

/** GET /servers/:id/files/content?path= */
async function readContent(req, res, next) {
  try {
    const server = requireServer(req.params.id);
    const result = await fileService.readFileContent(server.path, req.query.path || '');
    res.json({ data: result });
  } catch (err) { next(err); }
}

/** PUT /servers/:id/files/content */
async function writeContent(req, res, next) {
  try {
    const server = requireServer(req.params.id);
    if (!req.body.path) return next(badRequest('path is required'));
    if (req.body.content === undefined) return next(badRequest('content is required'));
    await fileService.writeFileContent(server.path, req.body.path, req.body.content);
    res.json({ data: { saved: true } });
  } catch (err) { next(err); }
}

module.exports = { list, download, upload, mkdir, rename, remove, readContent, writeContent };
