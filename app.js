'use strict';

/**
 * YAMS — Yet Another Minecraft Server Manager
 * Entry point: configures Express, mounts routes, starts HTTP listener.
 */

const express = require('express');
const swaggerUi = require('swagger-ui-express');

// Importing db.js triggers the singleton init + schema migration on startup.
// Importing serverService.js triggers reconcileOnStartup() which resets any
// stale 'running' status from a previous session that crashed.
const { getDb } = require('./src/db');
require('./src/services/serverService');

const serverRoutes = require('./src/routes/serverRoutes');
const swaggerSpec = require('./src/swagger');
const { createWsServer } = require('./src/websocket/wsServer');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use(express.json());

// Basic request logger
app.use((req, _res, next) => {
  console.log(`[YAMS] ${req.method} ${req.path}`);
  next();
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.use('/servers', serverRoutes);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ---------------------------------------------------------------------------
// Error handlers (must be registered AFTER all routes)
// ---------------------------------------------------------------------------

// 404 — no route matched
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

/**
 * Global error handler.
 * Express identifies this as an error handler because it has exactly 4 params.
 *
 * Operational errors (AppError instances with isOperational=true):
 *   — safe to expose the message to the client.
 *
 * Programming/unexpected errors:
 *   — log the full stack, return a generic 500 to avoid leaking internals.
 */
app.use((err, _req, res, _next) => {
  if (err.isOperational) {
    return res.status(err.statusCode).json({ error: err.message });
  }

  console.error('[YAMS] Unexpected error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

// Ensure DB is initialized (runs migration) before accepting connections
getDb();

app.listen(PORT, () => {
  console.log(`[YAMS] Server manager running on http://localhost:${PORT}`);
  console.log('[YAMS] Endpoints:');
  console.log('  POST   /servers');
  console.log('  GET    /servers');
  console.log('  GET    /servers/:id');
  console.log('  POST   /servers/:id/start');
  console.log('  POST   /servers/:id/stop');
  console.log(`[YAMS] Swagger UI → http://localhost:${PORT}/api-docs`);

  // Start the WebSocket console server alongside the HTTP API
  createWsServer();
});

module.exports = app;
