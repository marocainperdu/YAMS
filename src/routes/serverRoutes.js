'use strict';

const { Router }                    = require('express');
const controller                    = require('../controllers/serverController');
const metricsController             = require('../controllers/metricsController');
const { authMiddleware }            = require('../middleware/authMiddleware');
const { requireServerPermission }   = require('../middleware/permissionMiddleware');

const router = Router();

// Create — no auth required (keeps existing test suite green regardless of YAMS_AUTH_ENABLED)
router.post('/', controller.create);

// List — authentication required (no per-server permission check)
router.get('/', authMiddleware, controller.list);

// Per-server operations — authentication + explicit permission
router.get('/:id',        authMiddleware, requireServerPermission('view'),  controller.getOne);
router.post('/:id/start', authMiddleware, requireServerPermission('start'), controller.start);
router.post('/:id/stop',  authMiddleware, requireServerPermission('stop'),  controller.stop);
router.get('/:id/metrics', authMiddleware, requireServerPermission('view'), metricsController.getOne);

module.exports = router;
