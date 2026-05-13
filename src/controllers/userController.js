'use strict';

const authService       = require('../services/authService');
const permissionService = require('../services/permissionService');
const userModel         = require('../models/userModel');
const serverModel       = require('../models/serverModel');
const { badRequest, notFound } = require('../utils/errors');

async function createUser(req, res, next) {
  try {
    const user = await authService.createUser(req.body);
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

module.exports = { createUser, listUsers, assignPermissions };
