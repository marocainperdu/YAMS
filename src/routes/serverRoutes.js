'use strict';

const path   = require('path');
const fsp    = require('fs/promises');
const busboy = require('busboy');
const { Router } = require('express');
const controller = require('../controllers/serverController');
const metricsController = require('../controllers/metricsController');
const { heavyOpLimiter } = require('../middleware/rateLimits');
const { authMiddleware, requireServerPermission } = require('../middleware/auth');
const { badRequest, notFound } = require('../utils/errors');
const serverModel = require('../models/serverModel');

const router = Router();

router.use(authMiddleware);

// Collection
router.post('/',         requireServerPermission('control'), controller.create);   // POST /servers
router.get('/',          requireServerPermission('read'),    controller.list);     // GET  /servers
router.post('/reorder',  requireServerPermission('control'), controller.reorder);  // POST /servers/reorder

// Single resource
router.get('/:id',        requireServerPermission('read'),    controller.getOne);         // GET    /servers/:id
router.patch('/:id/settings', requireServerPermission('control'), controller.updateSettings); // PATCH  /servers/:id/settings
router.delete('/:id',     requireServerPermission('control'), controller.remove);  // DELETE /servers/:id
router.post('/:id/start', heavyOpLimiter, requireServerPermission('control'), controller.start);   // POST /servers/:id/start
router.post('/:id/stop',  requireServerPermission('control'), controller.stop);    // POST /servers/:id/stop

// Modpack install management
router.post('/:id/cancel-install', requireServerPermission('control'), controller.cancelInstall); // POST /servers/:id/cancel-install

// Mod upload — dedicated endpoint that allows .jar files (general file upload blocks them).
// Only writes into <serverPath>/mods/ — cannot escape that directory.
router.post('/:id/mods/upload', requireServerPermission('control'), async (req, res, next) => {
  try {
    const server = serverModel.findById(req.params.id);
    if (!server) return next(notFound('Server not found'));

    const SERVERS_ROOT = process.env.YAMS_SERVERS_ROOT || path.join(__dirname, '..', '..', 'servers');
    const modsDir = path.join(SERVERS_ROOT, server.id, 'mods');
    await fsp.mkdir(modsDir, { recursive: true });

    const bb = busboy({ headers: req.headers, limits: { fileSize: 256 * 1024 * 1024 } });
    const uploads = [];

    bb.on('file', (_field, stream, info) => {
      const filename = path.basename(info.filename);
      if (!filename.endsWith('.jar')) {
        stream.resume();
        return;
      }
      const dest = path.join(modsDir, filename);
      const promise = fsp.open(dest, 'w').then(fh => {
        return new Promise((resolve, reject) => {
          stream.on('data', chunk => fh.write(chunk));
          stream.on('end',  () => fh.close().then(() => resolve(filename)));
          stream.on('error', err => fh.close().then(() => reject(err)));
        });
      });
      uploads.push(promise);
    });

    bb.on('finish', async () => {
      try {
        const saved = await Promise.all(uploads);
        res.json({ data: saved });
      } catch (err) { next(err); }
    });

    bb.on('error', next);
    req.pipe(bb);
  } catch (err) { next(err); }
});

// Metrics
router.get('/:id/metrics', requireServerPermission('read'), metricsController.getOne); // GET /servers/:id/metrics

module.exports = router;
