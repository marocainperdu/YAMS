'use strict';

const { verifyToken } = require('../services/authService');
const { unauthorized } = require('../utils/errors');

// When YAMS_AUTH_ENABLED is not set the middleware is a transparent no-op so
// that all pre-existing tests (which never send tokens) keep passing as-is.

function authMiddleware(req, _res, next) {
  if (!process.env.YAMS_AUTH_ENABLED) return next();

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(unauthorized('Missing or invalid Authorization header', 'MISSING_TOKEN'));
  }

  const payload = verifyToken(header.slice(7));
  if (!payload) return next(unauthorized('Invalid or expired token', 'INVALID_TOKEN'));

  req.user = payload;
  next();
}

module.exports = { authMiddleware };
