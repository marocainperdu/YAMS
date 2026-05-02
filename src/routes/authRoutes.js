'use strict';

const { Router }         = require('express');
const rateLimit          = require('express-rate-limit');
const controller         = require('../controllers/authController');
const { authMiddleware } = require('../middleware/authMiddleware');
const twoFARoutes        = require('./twoFARoutes');

const router = Router();

// H1 — Rate-limit login: 20 attempts per 15 min per IP.
// Skipped when auth is disabled (tests / dev without YAMS_AUTH_ENABLED).
const loginLimiter = rateLimit({
  windowMs:       15 * 60 * 1000,
  max:            20,
  standardHeaders: true,
  legacyHeaders:  false,
  skip:           () => !process.env.YAMS_AUTH_ENABLED,
  message:        { error: 'Too many login attempts. Please try again later.' },
});

router.post('/login',     loginLimiter, controller.login);              // POST  /auth/login
router.get('/me',         authMiddleware, controller.getMe);            // GET   /auth/me
router.patch('/me',       authMiddleware, controller.updateMe);         // PATCH /auth/me
router.patch('/password', authMiddleware, controller.changePassword);   // PATCH /auth/password
router.use('/2fa',        twoFARoutes);                                 // /auth/2fa/*

module.exports = router;
