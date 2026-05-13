'use strict';

const { verifyToken } = require('../services/authService');
const { unauthorized, forbidden } = require('../utils/errors');

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

  // C2 — tokens with scope=change_password may only reach PATCH /auth/password
  if (payload.scope === 'change_password') {
    const path = req.originalUrl.split('?')[0];
    const isPasswordRoute = req.method === 'PATCH' && /\/auth\/password$/.test(path);
    if (!isPasswordRoute) {
      return next(forbidden('Password change required before accessing this resource', 'FORCE_PASSWORD_CHANGE'));
    }
  }

  req.user = payload;
  next();
}

module.exports = { authMiddleware };
