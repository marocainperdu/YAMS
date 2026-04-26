'use strict';

/**
 * YAMS — Yet Another Minecraft Server Manager
 * Entry point: configures Express, mounts routes, starts HTTP listener.
 */

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const swaggerUi = require('swagger-ui-express');

// Importing db.js triggers the singleton init + schema migration on startup.
// Importing serverService.js triggers reconcileOnStartup() which resets any
// stale 'running' status from a previous session that crashed.
const { getDb } = require('./src/db');
require('./src/services/serverService');

const serverRoutes  = require('./src/routes/serverRoutes');
const fileRoutes    = require('./src/routes/fileRoutes');
const backupRoutes  = require('./src/routes/backupRoutes');
const metricsRoutes = require('./src/routes/metricsRoutes');
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
app.use('/servers/:id/files', fileRoutes);
app.use('/servers/:id/backups', backupRoutes);
app.use('/metrics', metricsRoutes);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ---------------------------------------------------------------------------
// Error handlers (must be registered AFTER all routes)
// ---------------------------------------------------------------------------

// ── Static frontend (only active when client/dist exists — i.e. inside Docker
//    or after a manual `npm run build` in client/). In local dev the Vite dev
//    server handles the frontend, so this block is a no-op.
const DIST_DIR  = path.join(__dirname, 'client', 'dist');
const INDEX_HTML = path.join(DIST_DIR, 'index.html');
if (fs.existsSync(INDEX_HTML)) {
  app.use(express.static(DIST_DIR));
  // SPA fallback — return index.html for any GET not already handled above so
  // that client-side routing (React Router) works on direct URL access.
  app.get('*', (_req, res) => res.sendFile(INDEX_HTML));
}

// 404 — no API route matched (non-GET requests or requests before dist exists)
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

// Capture the http.Server so we can attach the WebSocket server to it.
// Both HTTP and WS share the same port — no separate WS_PORT needed.
const server = app.listen(PORT, () => {
  console.log(`[YAMS] Running on http://localhost:${PORT}`);
  console.log('[YAMS] Endpoints:');
  console.log('  POST   /servers');
  console.log('  GET    /servers');
  console.log('  GET    /servers/:id');
  console.log('  POST   /servers/:id/start');
  console.log('  POST   /servers/:id/stop');
  console.log('  GET    /servers/:id/files');
  console.log('  GET    /servers/:id/files/download?path=');
  console.log('  POST   /servers/:id/files/upload');
  console.log('  POST   /servers/:id/files/mkdir');
  console.log('  PUT    /servers/:id/files/rename');
  console.log('  DELETE /servers/:id/files');
  console.log('  POST   /servers/:id/backups');
  console.log('  GET    /servers/:id/backups');
  console.log('  GET    /servers/:id/backups/:backupId/download');
  console.log('  DELETE /servers/:id/backups/:backupId');
  console.log('  POST   /servers/:id/backups/:backupId/restore');
  console.log('  GET    /metrics');
  console.log(`  WS     ws://localhost:${PORT}/ws`);
  console.log(`  Docs   http://localhost:${PORT}/api-docs`);

  // Attach the WebSocket console server to the same HTTP server
  createWsServer(server);
});

module.exports = app;
