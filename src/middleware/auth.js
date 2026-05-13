'use strict';

// When YAMS_AUTH_ENABLED is not 'true' every middleware in this module is a
// pass-through no-op.  This preserves backward compatibility: all existing
// tests and local-only deployments continue to work without any configuration.

const AUTH_ENABLED = process.env.YAMS_AUTH_ENABLED === 'true';

// Fail fast at startup when auth is enabled but no signing key is configured.
// Catches misconfigured deployments before the first request arrives.
if (AUTH_ENABLED) {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim() === '') {
    throw new Error('[YAMS] YAMS_AUTH_ENABLED=true but JWT_SECRET is not set. Refusing to start.');
  }
}

// jsonwebtoken is a production dependency (npm install jsonwebtoken).
// Only required when auth is enabled so that test runs without the package
// installed would still work (the guard above short-circuits first).
const jwt = AUTH_ENABLED ? require('jsonwebtoken') : null;
const { securityLog } = require('../utils/securityLog');

function clientIp(req) {
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}

// ─── Authentication ───────────────────────────────────────────────────────────
//
// Verifies the Bearer JWT and attaches req.user = { userId, role, ... }.
// Token must be signed with JWT_SECRET and carry at minimum: userId, role.
// Invalid / expired tokens → 401.  Missing header → 401.

function authMiddleware(req, res, next) {
  if (!AUTH_ENABLED) return next();

  const ip     = clientIp(req);
  const header = req.headers['authorization'] ?? '';
  if (!header.startsWith('Bearer ')) {
    securityLog('warn', 'auth.failed', { ip, reason: 'missing_bearer' });
    return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
  }

  const token = header.slice(7);
  if (!token) {
    securityLog('warn', 'auth.failed', { ip, reason: 'empty_token' });
    return res.status(401).json({ error: 'Invalid token', code: 'INVALID_TOKEN' });
  }

  let payload;
  try {
    // algorithms whitelist prevents algorithm-confusion attacks (e.g. RS256→HS256 swap,
    // or the 'none' algorithm that bypasses signature verification entirely).
    payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    securityLog('warn', 'auth.failed', { ip, reason: err.name }); // e.g. TokenExpiredError
    return res.status(401).json({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' });
  }

  // Strict payload validation — missing or wrongly-typed claims → 401.
  const validRoles = new Set(['admin', 'operator', 'user']);
  const userIdOk   = payload.userId !== undefined && payload.userId !== null &&
                     (typeof payload.userId === 'string' || typeof payload.userId === 'number');
  const roleOk     = typeof payload.role === 'string' && validRoles.has(payload.role);

  if (!userIdOk || !roleOk) {
    securityLog('warn', 'auth.failed', { ip, reason: 'invalid_claims' });
    return res.status(401).json({ error: 'Token is missing required claims', code: 'INVALID_TOKEN' });
  }

  securityLog('info', 'auth.success', { ip, userId: payload.userId, role: payload.role });
  req.user = payload; // { userId, role, iat, exp, ... }
  next();
}

// ─── Authorization ────────────────────────────────────────────────────────────
//
// Returns a middleware that enforces permission level for the server identified
// by req.params.id.
//
// Supported actions:
//   'read'    — list / inspect / download  (non-destructive)
//   'control' — mutate (import, delete, set active, restore, upload, …)
//
// Role hierarchy:
//   admin    → all actions
//   operator → read + control
//   user     → read only
//
// Default deny: any request without an authenticated req.user → 403.

function requireServerPermission(action) {
  return function serverPermissionMiddleware(req, res, next) {
    if (!AUTH_ENABLED) return next();

    // authMiddleware must run before this.
    if (!req.user) {
      securityLog('warn', 'rbac.denied', { ip: clientIp(req), action, reason: 'no_user' });
      return res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
    }

    const { role, userId } = req.user;

    if (role === 'admin') return next();
    if (action === 'read'    && (role === 'operator' || role === 'user')) return next();
    if (action === 'control' &&  role === 'operator')                     return next();

    securityLog('warn', 'rbac.denied', { ip: clientIp(req), userId, role, action, serverId: req.params?.id });
    return res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
  };
}

// ─── Admin gate ───────────────────────────────────────────────────────────────
//
// Enforces that the caller has the 'admin' role.
// Must run after authMiddleware.

function requireAdmin(req, res, next) {
  if (!AUTH_ENABLED) return next();

  if (!req.user || req.user.role !== 'admin') {
    securityLog('warn', 'rbac.denied', {
      ip:     clientIp(req),
      userId: req.user?.userId,
      role:   req.user?.role,
      action: 'admin',
    });
    return res.status(403).json({ error: 'Admin only', code: 'FORBIDDEN' });
  }
  next();
}

module.exports = { authMiddleware, requireServerPermission, requireAdmin };
