'use strict';

const { unauthorized, forbidden } = require('../utils/errors');
const permissionService           = require('../services/permissionService');

// Same no-op gate as authMiddleware — disabled when YAMS_AUTH_ENABLED is unset.

function requireAdmin(req, _res, next) {
  if (!process.env.YAMS_AUTH_ENABLED) return next();
  if (!req.user) return next(unauthorized('Authentication required'));
  if (req.user.role !== 'admin') return next(forbidden('Admin access required'));
  next();
}

function requireServerPermission(permission) {
  return (req, _res, next) => {
    if (!process.env.YAMS_AUTH_ENABLED) return next();
    if (!req.user) return next(unauthorized('Authentication required'));

    if (req.user.role === 'admin') return next(); // admins bypass all checks

    if (!permissionService.hasPermission(req.user.userId, req.params.id, permission)) {
      return next(forbidden(`Permission "${permission}" required`, 'PERMISSION_DENIED'));
    }
    next();
  };
}

module.exports = { requireAdmin, requireServerPermission };
