'use strict';

const { Router } = require('express');
const controller  = require('../controllers/authController');
const { authMiddleware, requireAdmin } = require('../middleware/auth');

const router = Router();

// POST /auth/login
router.post('/login',   controller.login);

// POST /auth/refresh
router.post('/refresh', controller.refresh);

// POST /auth/logout  — authenticated; revokes the provided refresh token
router.post('/logout',  authMiddleware, controller.logout);

// POST /auth/logout-all — authenticated; revokes all refresh tokens for the caller
router.post('/logout-all', authMiddleware, controller.logoutAll);

// POST /auth/register — admin only
router.post('/register', authMiddleware, requireAdmin, controller.register);

// GET  /auth/me       — returns current user profile
router.get('/me',       authMiddleware, controller.getMe);

// PATCH /auth/me      — update username / email
router.patch('/me',     authMiddleware, controller.updateMe);

// PATCH /auth/password — change own password
router.patch('/password', authMiddleware, controller.changePassword);

// PUT /auth/avatar — upload avatar (base64 data URL)
router.put('/avatar', authMiddleware, controller.updateAvatar);

module.exports = router;
