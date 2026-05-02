'use strict';

const crypto    = require('crypto');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const userModel = require('../models/userModel');
const { badRequest, conflict, unauthorized, notFound } = require('../utils/errors');

// C1 — Fail-fast: JWT_SECRET is mandatory when auth is enabled
if (process.env.YAMS_AUTH_ENABLED && !process.env.JWT_SECRET) {
  throw new Error('[YAMS] FATAL: YAMS_AUTH_ENABLED requires JWT_SECRET to be set.');
}

const JWT_SECRET  = process.env.JWT_SECRET || 'dev-secret-unused';
const JWT_EXPIRY  = '7d';
const SALT_ROUNDS = 10;
const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// C3 — TOTP brute-force: in-memory per-user lockout
const totpLockouts     = new Map(); // userId -> { attempts, lockedUntil }
const TOTP_MAX_ATTEMPTS = 5;
const TOTP_LOCKOUT_MS   = 15 * 60 * 1000;

// ── Public API ────────────────────────────────────────────────────────────────

async function createUser({ email, password, role = 'user' }) {
  if (!email || !EMAIL_RE.test(email))         throw badRequest('A valid email is required');
  if (!password || password.length < 6)        throw badRequest('Password must be at least 6 characters');
  if (!['admin', 'user'].includes(role))       throw badRequest('Role must be "admin" or "user"');

  const normalised = email.toLowerCase();
  if (userModel.findByEmail(normalised))       throw conflict('Email already in use');

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const user = userModel.create({ email: normalised, passwordHash, role });
  return { id: user.id, email: user.email, role: user.role };
}

async function login({ email, password, totpCode }) {
  if (!email || !password) throw badRequest('Email and password are required');

  const user = userModel.findByEmail(email.toLowerCase());
  if (!user) throw unauthorized('Invalid credentials');

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) throw unauthorized('Invalid credentials');

  if (user.totp_enabled) {
    if (!totpCode) return { requiresTOTP: true };

    // C3 — lockout check before attempting TOTP verification
    const lockout = totpLockouts.get(user.id);
    if (lockout && Date.now() < lockout.lockedUntil) {
      throw unauthorized('Too many failed attempts. Try again later.');
    }

    const { verifyCode } = require('./twoFAService');
    if (!verifyCode(user, String(totpCode))) {
      const entry = totpLockouts.get(user.id) || { attempts: 0, lockedUntil: 0 };
      entry.attempts += 1;
      if (entry.attempts >= TOTP_MAX_ATTEMPTS) {
        entry.lockedUntil = Date.now() + TOTP_LOCKOUT_MS;
      }
      totpLockouts.set(user.id, entry);
      throw unauthorized('Invalid authenticator code');
    }

    totpLockouts.delete(user.id);
  }

  // C2 — restricted scope for accounts that must change their password
  const scope     = user.must_change_password === 1 ? 'change_password' : 'full';
  const expiresIn = user.must_change_password === 1 ? '1h' : JWT_EXPIRY;
  const token     = jwt.sign(
    { userId: user.id, role: user.role, scope },
    JWT_SECRET,
    { expiresIn, algorithm: 'HS256' }
  );
  return { token, forcePasswordChange: user.must_change_password === 1, username: user.username ?? null };
}

async function getMe(userId) {
  const user = userModel.findById(userId);
  if (!user) throw notFound('User not found');
  return { id: user.id, email: user.email, username: user.username ?? null, role: user.role, created_at: user.created_at, totpEnabled: user.totp_enabled === 1 };
}

async function updateMe(userId, { username, email } = {}) {
  const user = userModel.findById(userId);
  if (!user) throw notFound('User not found');

  let newEmail    = user.email;
  let newUsername = user.username ?? null;

  if (email !== undefined) {
    const trimmed = String(email).toLowerCase().trim();
    if (!EMAIL_RE.test(trimmed)) throw badRequest('A valid email is required');
    const taken = userModel.findByEmail(trimmed);
    if (taken && taken.id !== userId) throw conflict('Email already in use');
    newEmail = trimmed;
  }

  if (username !== undefined) {
    const trimmed = String(username).trim();
    if (trimmed.length === 0 || trimmed.length > 64) throw badRequest('Username must be between 1 and 64 characters');
    newUsername = trimmed;
  }

  userModel.updateProfile(userId, { email: newEmail, username: newUsername });
  return { id: user.id, email: newEmail, username: newUsername, role: user.role };
}

async function changePassword(userId, { currentPassword, newPassword }) {
  if (!currentPassword)                        throw badRequest('Current password is required');
  if (!newPassword || newPassword.length < 8)  throw badRequest('New password must be at least 8 characters');

  const user = userModel.findById(userId);
  if (!user) throw notFound('User not found');

  const match = await bcrypt.compare(currentPassword, user.password_hash);
  if (!match) throw unauthorized('Current password is incorrect');

  const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  userModel.updatePassword(userId, newHash);
}

// H4 — pin algorithm to HS256 to prevent confusion attacks
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return null;
  }
}

// ── Startup seeding ───────────────────────────────────────────────────────────

function generateSecurePassword() {
  const upper   = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower   = 'abcdefghijklmnopqrstuvwxyz';
  const digits  = '0123456789';
  const symbols = '!@#$%^&*()-_=+[]{}|;:,.<>?';
  const all     = upper + lower + digits + symbols;

  const required = [
    upper[crypto.randomInt(upper.length)],
    lower[crypto.randomInt(lower.length)],
    digits[crypto.randomInt(digits.length)],
    symbols[crypto.randomInt(symbols.length)],
  ];
  const rest = Array.from({ length: 12 }, () => all[crypto.randomInt(all.length)]);

  const chars = [...required, ...rest];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function seedAdminIfEmpty() {
  if (!process.env.YAMS_AUTH_ENABLED) return;
  if (userModel.count() > 0) return;

  const email    = process.env.YAMS_ADMIN_EMAIL || 'admin@yams.local';
  const provided = process.env.YAMS_ADMIN_PASSWORD;
  const password = provided || generateSecurePassword();

  const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);
  userModel.create({ email, passwordHash, role: 'admin', mustChangePassword: !provided });

  if (!provided) {
    console.log('========================================');
    console.log(' YAMS INITIAL ADMIN ACCOUNT CREATED');
    console.log('----------------------------------------');
    console.log(` Username: ${email}`);
    console.log(` Password: ${password}`);
    console.log('----------------------------------------');
    console.log(' You MUST change this password on first login.');
    console.log('========================================');
  } else {
    console.log(`[YAMS] Seeded default admin: ${email}`);
  }
}

module.exports = { createUser, login, getMe, updateMe, changePassword, verifyToken, seedAdminIfEmpty };
