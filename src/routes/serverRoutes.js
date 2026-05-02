'use strict';

const { Router }                  = require('express');
const controller                  = require('../controllers/serverController');
const metricsController           = require('../controllers/metricsController');
const { authMiddleware }          = require('../middleware/authMiddleware');
const { requireServerPermission } = require('../middleware/permissionMiddleware');

const router = Router();

// POST /servers — no auth (keeps existing test suite green regardless of YAMS_AUTH_ENABLED)
router.post('/', controller.create);

// GET /servers — authentication required, no per-server permission check
router.get('/', authMiddleware, controller.list);

// Per-server operations — authentication + explicit permission
router.get('/:id',         authMiddleware, requireServerPermission('read'),    controller.getOne);
router.post('/:id/start',  authMiddleware, requireServerPermission('control'), controller.start);
router.post('/:id/stop',   authMiddleware, requireServerPermission('control'), controller.stop);
router.get('/:id/metrics', authMiddleware, requireServerPermission('read'),    metricsController.getOne);

module.exports = router;
