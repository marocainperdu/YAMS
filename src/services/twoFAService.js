'use strict';

const crypto                              = require('crypto');
const { generateSecret, generateSync, verifySync, TOTP } = require('otplib');
const bcrypt                              = require('bcryptjs');

const _totp = new TOTP();
const userModel          = require('../models/userModel');
const { badRequest, notFound, unauthorized } = require('../utils/errors');

const ISSUER = 'YAMS';

// ── H3: TOTP secret encryption (AES-256-GCM) ─────────────────────────────────
// Key derived from TOTP_SECRET_KEY env var, falling back to JWT_SECRET.
// When neither is set (auth disabled / dev), secrets are stored as plaintext.

function getTotpKey() {
  const raw = process.env.TOTP_SECRET_KEY || process.env.JWT_SECRET;
  if (!raw) return null;
  return crypto.createHash('sha256').update(raw).digest(); // 32 bytes
}

function encryptSecret(plaintext) {
  const key = getTotpKey();
  if (!key) return plaintext;
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return `enc:v1:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decryptSecret(stored) {
  if (!stored) return null;
  if (!stored.startsWith('enc:v1:')) return stored; // plaintext — backward compat
  const key = getTotpKey();
  if (!key) return stored;
  try {
    const parts = stored.split(':');           // ['enc','v1', iv, tag, ciphertext]
    const iv    = Buffer.from(parts[2], 'hex');
    const tag   = Buffer.from(parts[3], 'hex');
    const enc   = Buffer.from(parts[4], 'hex');
    const dec   = crypto.createDecipheriv('aes-256-gcm', key, iv);
    dec.setAuthTag(tag);
    return Buffer.concat([dec.update(enc), dec.final()]).toString('utf8');
  } catch {
    return null;
  }
}

// ── Service functions ─────────────────────────────────────────────────────────

function setup(userId) {
  const user = userModel.findById(userId);
  if (!user) throw notFound('User not found');
  if (user.totp_enabled) throw badRequest('2FA is already enabled');

  const secret = generateSecret();
  // H3 — store encrypted secret; totp_enabled stays 0 until verified
  userModel.updateTotp(userId, { secret: encryptSecret(secret), enabled: false });

  const otpauthUri = _totp.toURI({ label: user.email || user.username, issuer: ISSUER, secret });
  return { secret, otpauthUri };
}

function enable(userId, code) {
  const user = userModel.findById(userId);
  if (!user) throw notFound('User not found');
  if (user.totp_enabled) throw badRequest('2FA is already enabled');
  if (!user.totp_secret) throw badRequest('Run setup first');

  const secret = decryptSecret(user.totp_secret);
  if (!secret) throw badRequest('Unable to verify. Run setup again.');

  if (!verifySync({ token: code, secret }).valid) {
    throw unauthorized('Invalid verification code');
  }

  // Keep the stored (possibly encrypted) secret; flip the enabled flag
  userModel.updateTotp(userId, { secret: user.totp_secret, enabled: true });
}

// M2 — disable requires current password + valid TOTP code
async function disable(userId, code, currentPassword) {
  const user = userModel.findById(userId);
  if (!user) throw notFound('User not found');
  if (!user.totp_enabled) throw badRequest('2FA is not enabled');

  if (!currentPassword) throw badRequest('Current password is required to disable 2FA');
  const match = await bcrypt.compare(currentPassword, user.password_hash);
  if (!match) throw unauthorized('Current password is incorrect');

  const secret = decryptSecret(user.totp_secret);
  if (!secret) throw badRequest('2FA configuration error. Contact an administrator.');

  if (!verifySync({ token: code, secret }).valid) {
    throw unauthorized('Invalid verification code');
  }

  userModel.updateTotp(userId, { secret: null, enabled: false });
}

// H2 — TOTP replay protection: reject codes that were already accepted
function verifyCode(user, code) {
  if (!user.totp_enabled || !user.totp_secret) return true;

  const secret = decryptSecret(user.totp_secret);
  if (!secret) return false;

  const codeHash = crypto.createHash('sha256').update(code).digest('hex');
  if (user.totp_last_code && codeHash === user.totp_last_code) return false;

  const valid = verifySync({ token: code, secret }).valid;
  if (valid) userModel.updateTotpLastCode(user.id, codeHash);
  return valid;
}

module.exports = { setup, enable, disable, verifyCode };
