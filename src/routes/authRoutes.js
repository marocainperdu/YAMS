'use strict';

const { Router }        = require('express');
const controller        = require('../controllers/authController');
const { authMiddleware } = require('../middleware/authMiddleware');
const twoFARoutes       = require('./twoFARoutes');

const router = Router();

router.post('/login',    controller.login);                             // POST  /auth/login
router.get('/me',        authMiddleware, controller.getMe);            // GET   /auth/me
router.patch('/me',      authMiddleware, controller.updateMe);         // PATCH /auth/me
router.patch('/password', authMiddleware, controller.changePassword);  // PATCH /auth/password
router.use('/2fa',       twoFARoutes);                                 // /auth/2fa/*

module.exports = router;
