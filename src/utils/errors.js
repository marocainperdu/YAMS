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

/** 400 Bad Request */
const badRequest = (msg) => new AppError(msg || 'Bad request', 400);

/** 404 Not Found */
const notFound = (msg) => new AppError(msg || 'Not found', 404);

/** 409 Conflict */
const conflict = (msg) => new AppError(msg || 'Conflict', 409);

/** 403 Forbidden */
const forbidden = (msg) => new AppError(msg || 'Forbidden', 403);

/** 500 Internal Server Error (operational) */
const internal = (msg) => new AppError(msg || 'Internal server error', 500);

module.exports = { AppError, badRequest, notFound, conflict, forbidden, internal };
