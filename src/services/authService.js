'use strict';

const crypto    = require('crypto');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const userModel = require('../models/userModel');
const { badRequest, conflict, unauthorized, notFound } = require('../utils/errors');

const JWT_SECRET  = process.env.JWT_SECRET || 'dev-secret';
const JWT_EXPIRY  = '7d';
const SALT_ROUNDS = 10;
const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    const { verifyCode } = require('./twoFAService');
    if (!verifyCode(user, String(totpCode))) throw unauthorized('Invalid authenticator code');
  }

  const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
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

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
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

  // Guarantee at least one from each class
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
