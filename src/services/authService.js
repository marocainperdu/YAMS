'use strict';

const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const userModel = require('../models/userModel');
const { badRequest, conflict, unauthorized } = require('../utils/errors');

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

async function login({ email, password }) {
  if (!email || !password) throw badRequest('Email and password are required');

  const user = userModel.findByEmail(email.toLowerCase());
  if (!user) throw unauthorized('Invalid credentials');

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) throw unauthorized('Invalid credentials');

  return jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// ── Startup seeding ───────────────────────────────────────────────────────────
// When YAMS_AUTH_ENABLED=true and no users exist yet, insert a default admin so
// the system is immediately usable (and tests can bootstrap themselves).

function seedAdminIfEmpty() {
  if (!process.env.YAMS_AUTH_ENABLED) return;
  if (userModel.count() > 0) return;

  const email    = process.env.YAMS_ADMIN_EMAIL    || 'admin@yams.local';
  const password = process.env.YAMS_ADMIN_PASSWORD || 'admin';

  const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);
  userModel.create({ email, passwordHash, role: 'admin' });
  console.log(`[YAMS] Seeded default admin: ${email}`);
}

module.exports = { createUser, login, verifyToken, seedAdminIfEmpty };
