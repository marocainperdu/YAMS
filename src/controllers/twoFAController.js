'use strict';

const twoFAService = require('../services/twoFAService');
const { badRequest } = require('../utils/errors');

async function setup(req, res, next) {
  try {
    if (!req.user) return next(badRequest('Auth not enabled'));
    const result = twoFAService.setup(req.user.userId);
    res.json({ data: result });
  } catch (err) { next(err); }
}

async function enable(req, res, next) {
  try {
    if (!req.user) return next(badRequest('Auth not enabled'));
    const { code } = req.body;
    if (!code) return next(badRequest('code is required'));
    twoFAService.enable(req.user.userId, String(code));
    res.json({ data: { success: true } });
  } catch (err) { next(err); }
}

async function disable(req, res, next) {
  try {
    if (!req.user) return next(badRequest('Auth not enabled'));
    const { code } = req.body;
    if (!code) return next(badRequest('code is required'));
    twoFAService.disable(req.user.userId, String(code));
    res.json({ data: { success: true } });
  } catch (err) { next(err); }
}

module.exports = { setup, enable, disable };
