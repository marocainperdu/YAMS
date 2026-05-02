'use strict';

const authService = require('../services/authService');

async function login(req, res, next) {
  try {
    const token = await authService.login(req.body);
    res.json({ data: { token } });
  } catch (err) {
    next(err);
  }
}

module.exports = { login };
