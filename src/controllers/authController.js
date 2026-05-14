'use strict';

const authService = require('../services/authService');

function extractBearer(req) {
  const h = req.headers['authorization'] ?? '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

async function login(req, res, next) {
  try {
    const { username, password } = req.body ?? {};
    const tokens = await authService.login(username, password);
    res.json({ data: tokens });
  } catch (err) {
    next(err);
  }
}

async function refresh(req, res, next) {
  try {
    const raw = extractBearer(req) ?? (req.body ?? {}).refreshToken;
    const tokens = await authService.refresh(raw);
    res.json({ data: tokens });
  } catch (err) {
    next(err);
  }
}

function logout(req, res, next) {
  try {
    const raw = extractBearer(req) ?? (req.body ?? {}).refreshToken;
    authService.logout(raw);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

function logoutAll(req, res, next) {
  try {
    authService.logoutAll(req.user.userId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

async function register(req, res, next) {
  try {
    const { username, password, role } = req.body ?? {};
    const user = await authService.register(username, password, role);
    res.status(201).json({ data: user });
  } catch (err) {
    next(err);
  }
}

async function getMe(req, res, next) {
  try {
    res.json({ data: authService.getMe(req.user.userId) });
  } catch (err) { next(err); }
}

async function updateMe(req, res, next) {
  try {
    const { username, email } = req.body ?? {};
    const data = await authService.updateMe(req.user.userId, { username, email });
    res.json({ data });
  } catch (err) { next(err); }
}

async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body ?? {};
    await authService.changePassword(req.user.userId, currentPassword, newPassword);
    res.status(204).end();
  } catch (err) { next(err); }
}

module.exports = { login, refresh, logout, logoutAll, register, getMe, updateMe, changePassword };
