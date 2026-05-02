'use strict';

const { Router }                  = require('express');
const controller                  = require('../controllers/serverController');
const metricsController           = require('../controllers/metricsController');
const jarController               = require('../controllers/jarController');
const { authMiddleware }          = require('../middleware/authMiddleware');
const { requireServerPermission } = require('../middleware/permissionMiddleware');

const router = Router();

// C4 — server creation now requires authentication
router.post('/', authMiddleware, controller.create);

// GET /servers — authentication required, no per-server permission check
router.get('/', authMiddleware, controller.list);

// Per-server operations — authentication + explicit permission
router.get('/:id',              authMiddleware, requireServerPermission('read'),    controller.getOne);
router.post('/:id/start',       authMiddleware, requireServerPermission('control'), controller.start);
router.post('/:id/stop',        authMiddleware, requireServerPermission('control'), controller.stop);
router.get('/:id/metrics',      authMiddleware, requireServerPermission('read'),    metricsController.getOne);
// C4 — JAR download requires control permission on the target server
router.post('/:id/download-jar', authMiddleware, requireServerPermission('control'), jarController.downloadJar);

module.exports = router;
