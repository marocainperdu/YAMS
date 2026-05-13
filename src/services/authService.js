'use strict';

const crypto  = require('crypto');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const userModel         = require('../models/userModel');
const refreshTokenModel = require('../models/refreshTokenModel');
const { unauthorized, conflict, badRequest } = require('../utils/errors');

const BCRYPT_ROUNDS        = 12;
const ACCESS_TOKEN_TTL     = '15m';
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function jwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('[YAMS] JWT_SECRET is not set');
  return s;
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function issueAccessToken(user) {
  return jwt.sign(
    { userId: user.id, role: user.role },
    jwtSecret(),
    { algorithm: 'HS256', expiresIn: ACCESS_TOKEN_TTL }
  );
}

function issueRefreshToken(userId) {
  const raw       = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(raw);
  const expiresAt = Date.now() + REFRESH_TOKEN_TTL_MS;
  refreshTokenModel.create({ id: uuidv4(), userId, tokenHash, expiresAt });
  return raw;
}

// ─── register ────────────────────────────────────────────────────────────────

async function register(username, password, role = 'operator') {
  if (!username || typeof username !== 'string' || username.trim().length < 3) {
    throw badRequest('Username must be at least 3 characters', 'INVALID_USERNAME');
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    throw badRequest('Password must be at least 8 characters', 'INVALID_PASSWORD');
  }
  const validRoles = new Set(['admin', 'operator', 'user']);
  if (!validRoles.has(role)) {
    throw badRequest('Invalid role', 'INVALID_ROLE');
  }
  if (userModel.findByUsername(username.trim())) {
    throw conflict('Username already exists', 'USERNAME_TAKEN');
  }
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = userModel.create({ id: uuidv4(), username: username.trim(), passwordHash, role });
  return { id: user.id, username: user.username, role: user.role };
}

// ─── login ───────────────────────────────────────────────────────────────────

async function login(username, password) {
  if (!username || !password) {
    throw badRequest('Username and password are required', 'MISSING_CREDENTIALS');
  }

  const user = userModel.findByUsername(username);

  // Always run bcrypt compare to prevent timing oracle even when user is missing.
  // Use a dummy hash so the compare always takes the same time.
  const dummyHash = '$2a$12$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.';
  const passwordHash = user ? user.password_hash : dummyHash;
  const match = await bcrypt.compare(password, passwordHash);

  if (!user || !match) {
    throw unauthorized('Invalid credentials', 'INVALID_CREDENTIALS');
  }

  // Opportunistically prune stale tokens on login
  refreshTokenModel.purgeStale();

  const accessToken  = issueAccessToken(user);
  const refreshToken = issueRefreshToken(user.id);
  return { accessToken, refreshToken };
}

// ─── refresh ─────────────────────────────────────────────────────────────────

async function refresh(rawToken) {
  if (!rawToken) throw unauthorized('Refresh token is required', 'MISSING_TOKEN');

  const tokenHash = hashToken(rawToken);
  const record    = refreshTokenModel.findByHash(tokenHash);

  if (!record) throw unauthorized('Invalid refresh token', 'INVALID_TOKEN');
  if (record.revoked)             throw unauthorized('Refresh token has been revoked', 'TOKEN_REVOKED');
  if (record.expires_at < Date.now()) throw unauthorized('Refresh token has expired', 'TOKEN_EXPIRED');

  const user = userModel.findById(record.user_id);
  if (!user) throw unauthorized('User not found', 'USER_NOT_FOUND');

  // Rotation: revoke consumed token, issue new pair
  refreshTokenModel.revoke(tokenHash);
  const accessToken     = issueAccessToken(user);
  const newRefreshToken = issueRefreshToken(user.id);
  return { accessToken, refreshToken: newRefreshToken };
}

// ─── logout ──────────────────────────────────────────────────────────────────

function logout(rawToken) {
  if (!rawToken) return;
  refreshTokenModel.revoke(hashToken(rawToken));
}

// ─── logoutAll ───────────────────────────────────────────────────────────────

function logoutAll(userId) {
  refreshTokenModel.revokeAll(userId);
}

// ─── seedAdmin ───────────────────────────────────────────────────────────────
// Called once at startup when YAMS_ADMIN_USERNAME / YAMS_ADMIN_PASSWORD are set
// and no users exist yet. Safe to call every boot — no-op if users already exist.

async function seedAdmin() {
  const username = process.env.YAMS_ADMIN_USERNAME;
  const password = process.env.YAMS_ADMIN_PASSWORD;
  if (!username || !password) return;
  if (userModel.count() > 0) return;
  await register(username, password, 'admin');
  console.log(`[YAMS] Admin user '${username}' created.`);
}

module.exports = { register, login, refresh, logout, logoutAll, seedAdmin };
