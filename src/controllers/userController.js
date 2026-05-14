'use strict';

const authService       = require('../services/authService');
const permissionService = require('../services/permissionService');
const userModel         = require('../models/userModel');
const serverModel       = require('../models/serverModel');
const { badRequest, notFound } = require('../utils/errors');

async function createUser(req, res, next) {
  try {
    const { username, password, role = 'operator' } = req.body;
    const user = await authService.register(username, password, role);
    res.status(201).json({ data: user });
  } catch (err) {
    next(err);
  }
}

function listUsers(req, res, next) {
  try {
    res.json({ data: userModel.findAll() });
  } catch (err) {
    next(err);
  }
}

function updateRole(req, res, next) {
  try {
    const { id } = req.params;
    const { role } = req.body;
    const validRoles = new Set(['admin', 'operator', 'user']);
    if (!role || !validRoles.has(role)) return next(badRequest('Invalid role. Must be admin, operator, or user.'));
    if (!userModel.findById(id)) return next(notFound('User not found'));
    if (req.user && req.user.userId === id) return next(badRequest('Cannot change your own role'));
    const updated = userModel.updateRole(id, role);
    res.json({ data: { id: updated.id, username: updated.username, role: updated.role } });
  } catch (err) {
    next(err);
  }
}

function removeUser(req, res, next) {
  try {
    const { id } = req.params;
    if (!userModel.findById(id)) return next(notFound('User not found'));
    if (req.user && req.user.userId === id) return next(badRequest('Cannot delete your own account'));
    userModel.remove(id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

function assignPermissions(req, res, next) {
  try {
    const { userId, serverId, permissions } = req.body;
    if (!userId)                                     return next(badRequest('userId is required'));
    if (!serverId)                                   return next(badRequest('serverId is required'));
    if (!permissions || typeof permissions !== 'object') return next(badRequest('permissions must be an object'));
    if (!userModel.findById(userId))                 return next(notFound('User not found'));
    if (!serverModel.findById(serverId))             return next(notFound('Server not found'));

    const record = permissionService.assignPermissions({ userId, serverId, permissions });
    res.json({ data: record });
  } catch (err) {
    next(err);
  }
}

module.exports = { createUser, listUsers, updateRole, removeUser, assignPermissions };
