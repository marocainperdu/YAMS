'use strict';

const { Router } = require('express');
const controller = require('../controllers/twoFAController');
const { authMiddleware } = require('../middleware/auth');

const router = Router();

router.post('/setup',   authMiddleware, controller.setup);    // POST  /auth/2fa/setup
router.post('/enable',  authMiddleware, controller.enable);   // POST  /auth/2fa/enable
router.delete('/',      authMiddleware, controller.disable);  // DELETE /auth/2fa

module.exports = router;
