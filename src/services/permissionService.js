'use strict';

const permissionModel = require('../models/permissionModel');

function getUserPermissions(userId, serverId) {
  const record = permissionModel.findByUserAndServer(userId, serverId);
  return record ? record.permissions : null;
}

function hasPermission(userId, serverId, permission) {
  const perms = getUserPermissions(userId, serverId);
  return perms !== null && perms[permission] === true;
}

function assignPermissions({ userId, serverId, permissions }) {
  return permissionModel.upsert({ userId, serverId, permissions });
}

function getPermissionsForUser(userId) {
  return permissionModel.findByUser(userId);
}

module.exports = { getUserPermissions, hasPermission, assignPermissions, getPermissionsForUser };
