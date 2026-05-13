'use strict';

const rateLimit = require('express-rate-limit');

// High-cost endpoint limiter: 5 requests per 10 minutes per IP.
// Applied individually to routes that trigger heavy I/O or process management:
//   POST /servers/:id/worlds/import
//   POST /servers/:id/backups
//   POST /servers/:id/start
const heavyOpLimiter = rateLimit({
  windowMs:         10 * 60 * 1000, // 10 minutes
  max:              5,
  standardHeaders:  true,            // Retry-After + RateLimit-* headers (RFC 9110)
  legacyHeaders:    false,
  message:          { error: 'Too many requests, please try again later.', code: 'RATE_LIMITED' },
  skipFailedRequests: false,
});

// Auth endpoint limiter: 10 requests per 15 minutes per IP.
// Applied to POST /auth/login and POST /auth/refresh to limit brute-force.
const authLimiter = rateLimit({
  windowMs:         15 * 60 * 1000, // 15 minutes
  max:              10,
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Too many attempts, please try again later.', code: 'RATE_LIMITED' },
  skipFailedRequests: false,
});

module.exports = { heavyOpLimiter, authLimiter };
