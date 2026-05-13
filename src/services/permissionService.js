'use strict';

const permissionModel = require('../models/permissionModel');

/** Returns all server-permission records for a user (across every server). */
function getUserPermissions(userId) {
  return permissionModel.findByUser(userId);
}

/** Returns true iff the user has the named permission on that specific server. */
function hasPermission(userId, serverId, permission) {
  const record = permissionModel.findByUserAndServer(userId, serverId);
  if (!record) return false;
  return record.permissions[permission] === true;
}

function assignPermissions({ userId, serverId, permissions }) {
  return permissionModel.assignPermissions({ userId, serverId, permissions });
}

module.exports = { getUserPermissions, hasPermission, assignPermissions };
