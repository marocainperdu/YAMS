'use strict';

/**
 * Operational error — safe to expose message to the client.
 * Programming errors (unexpected failures) should NOT use this class;
 * let them bubble to the global handler which returns a generic 500.
 */
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    // Capture stack without this constructor frame
    Error.captureStackTrace(this, this.constructor);
  }
}

// --- Factory functions used throughout the service layer ---

function _make(msg, statusCode, code) {
  const e = new AppError(msg, statusCode);
  if (code) e.code = code;
  return e;
}

/** 400 Bad Request */
const badRequest = (msg, code) => _make(msg || 'Bad request', 400, code);

/** 404 Not Found */
const notFound = (msg, code) => _make(msg || 'Not found', 404, code);

/** 409 Conflict */
const conflict = (msg, code) => _make(msg || 'Conflict', 409, code);

/** 403 Forbidden */
const forbidden = (msg, code) => _make(msg || 'Forbidden', 403, code);

/** 413 Payload Too Large */
const tooLarge = (msg, code) => _make(msg || 'Payload too large', 413, code);

/** 500 Internal Server Error (operational) */
const internal = (msg, code) => _make(msg || 'Internal server error', 500, code);

module.exports = { AppError, badRequest, notFound, conflict, forbidden, tooLarge, internal };
