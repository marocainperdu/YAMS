'use strict';

const { Router } = require('express');
const controller = require('../controllers/serverController');

const router = Router();

// Collection
router.post('/',  controller.create);   // POST /servers       — create a server
router.get('/',   controller.list);     // GET  /servers       — list all servers

// Single resource
router.get('/:id',        controller.getOne);  // GET  /servers/:id       — get one server
router.post('/:id/start', controller.start);   // POST /servers/:id/start — start a server
router.post('/:id/stop',  controller.stop);    // POST /servers/:id/stop  — stop a server

module.exports = router;
