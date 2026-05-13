'use strict';

const { Router } = require('express');
const controller = require('../controllers/serverController');
const metricsController = require('../controllers/metricsController');
const { heavyOpLimiter } = require('../middleware/rateLimits');

const router = Router();

// Collection
router.post('/',  controller.create);   // POST /servers       — create a server
router.get('/',   controller.list);     // GET  /servers       — list all servers

// Single resource
router.get('/:id',        controller.getOne);  // GET    /servers/:id       — get one server
router.delete('/:id',     controller.remove);  // DELETE /servers/:id       — delete a server
router.post('/:id/start', heavyOpLimiter, controller.start);   // POST /servers/:id/start — start a server
router.post('/:id/stop',  controller.stop);    // POST /servers/:id/stop  — stop a server

// Metrics
router.get('/:id/metrics', metricsController.getOne); // GET /servers/:id/metrics

module.exports = router;
