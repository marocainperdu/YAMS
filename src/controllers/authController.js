'use strict';

const authService = require('../services/authService');
const { badRequest } = require('../utils/errors');

async function login(req, res, next) {
  try {
    const result = await authService.login(req.body);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

async function changePassword(req, res, next) {
  try {
    if (!req.user) return next(badRequest('Auth not enabled'));
    await authService.changePassword(req.user.userId, req.body);
    res.json({ data: { success: true } });
  } catch (err) {
    next(err);
  }
}

module.exports = { login, changePassword };
