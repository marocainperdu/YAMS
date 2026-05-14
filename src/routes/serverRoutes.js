'use strict';

const { Router } = require('express');
const controller = require('../controllers/serverController');
const metricsController = require('../controllers/metricsController');
const { heavyOpLimiter } = require('../middleware/rateLimits');
const { authMiddleware, requireServerPermission } = require('../middleware/auth');

const router = Router();

router.use(authMiddleware);

// Collection
router.post('/',         requireServerPermission('control'), controller.create);   // POST /servers
router.get('/',          requireServerPermission('read'),    controller.list);     // GET  /servers
router.post('/reorder',  requireServerPermission('control'), controller.reorder);  // POST /servers/reorder

// Single resource
router.get('/:id',        requireServerPermission('read'),    controller.getOne);  // GET    /servers/:id
router.delete('/:id',     requireServerPermission('control'), controller.remove);  // DELETE /servers/:id
router.post('/:id/start', heavyOpLimiter, requireServerPermission('control'), controller.start);   // POST /servers/:id/start
router.post('/:id/stop',  requireServerPermission('control'), controller.stop);    // POST /servers/:id/stop

// Metrics
router.get('/:id/metrics', requireServerPermission('read'), metricsController.getOne); // GET /servers/:id/metrics

module.exports = router;
