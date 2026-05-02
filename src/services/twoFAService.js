'use strict';

const { authenticator } = require('otplib');
const userModel = require('../models/userModel');
const { badRequest, notFound, unauthorized } = require('../utils/errors');

const ISSUER = 'YAMS';

function setup(userId) {
  const user = userModel.findById(userId);
  if (!user) throw notFound('User not found');
  if (user.totp_enabled) throw badRequest('2FA is already enabled');

  const secret = authenticator.generateSecret();
  // Store the secret but keep totp_enabled = 0 until verified
  userModel.updateTotp(userId, { secret, enabled: false });

  const otpauthUri = authenticator.keyuri(user.email, ISSUER, secret);
  return { secret, otpauthUri };
}

function enable(userId, code) {
  const user = userModel.findById(userId);
  if (!user) throw notFound('User not found');
  if (user.totp_enabled) throw badRequest('2FA is already enabled');
  if (!user.totp_secret) throw badRequest('Run setup first');

  if (!authenticator.verify({ token: code, secret: user.totp_secret })) {
    throw unauthorized('Invalid verification code');
  }

  userModel.updateTotp(userId, { secret: user.totp_secret, enabled: true });
}

function disable(userId, code) {
  const user = userModel.findById(userId);
  if (!user) throw notFound('User not found');
  if (!user.totp_enabled) throw badRequest('2FA is not enabled');

  if (!authenticator.verify({ token: code, secret: user.totp_secret })) {
    throw unauthorized('Invalid verification code');
  }

  userModel.updateTotp(userId, { secret: null, enabled: false });
}

function verifyCode(user, code) {
  if (!user.totp_enabled || !user.totp_secret) return true;
  return authenticator.verify({ token: code, secret: user.totp_secret });
}

module.exports = { setup, enable, disable, verifyCode };
