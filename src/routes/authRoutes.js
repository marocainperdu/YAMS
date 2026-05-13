'use strict';

const { Router } = require('express');
const controller  = require('../controllers/authController');
const { authMiddleware, requireAdmin } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimits');

const router = Router();

// POST /auth/login   — public, rate-limited
router.post('/login',   authLimiter, controller.login);

// POST /auth/refresh — public, rate-limited (refresh token in Authorization or body)
router.post('/refresh', authLimiter, controller.refresh);

// POST /auth/logout  — authenticated; revokes the provided refresh token
router.post('/logout',  authMiddleware, controller.logout);

// POST /auth/logout-all — authenticated; revokes all refresh tokens for the caller
router.post('/logout-all', authMiddleware, controller.logoutAll);

// POST /auth/register — admin only
router.post('/register', authMiddleware, requireAdmin, controller.register);

module.exports = router;
