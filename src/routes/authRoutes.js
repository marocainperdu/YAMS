'use strict';

const { Router }        = require('express');
const controller        = require('../controllers/authController');
const { authMiddleware } = require('../middleware/authMiddleware');

const router = Router();

router.post('/login',    controller.login);                             // POST  /auth/login
router.patch('/password', authMiddleware, controller.changePassword);  // PATCH /auth/password

module.exports = router;
