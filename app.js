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
require('./src/services/metricsService').init();   // start log parsing listeners
require('./src/services/schedulerService').init(); // start cron tick loop
require('./src/services/webhookService').init();   // subscribe to server lifecycle events

const authRoutes    = require('./src/routes/authRoutes');
const twoFARoutes   = require('./src/routes/twoFARoutes');
const serverRoutes  = require('./src/routes/serverRoutes');
const modpackRoutes = require('./src/routes/modpackRoutes');
const fileRoutes    = require('./src/routes/fileRoutes');
const backupRoutes  = require('./src/routes/backupRoutes');
const worldRoutes   = require('./src/routes/worldRoutes');
const metricsRoutes   = require('./src/routes/metricsRoutes');
const scheduleRoutes  = require('./src/routes/scheduleRoutes');
const webhookRoutes   = require('./src/routes/webhookRoutes');
const { userRouter, permissionRouter } = require('./src/routes/userRoutes');
const swaggerSpec = require('./src/swagger');
const { createWsServer } = require('./src/websocket/wsServer');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use(express.json({ limit: '4mb' }));

// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Basic request logger
app.use((req, _res, next) => {
  console.log(`[YAMS] ${req.method} ${req.path}`);
  next();
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api/auth/2fa',                twoFARoutes);
app.use('/api/auth',                    authRoutes);
app.use('/api/servers',                 serverRoutes);
app.use('/api/modpacks',                modpackRoutes);
app.use('/api/servers/:id/files',       fileRoutes);
app.use('/api/servers/:id/backups',     backupRoutes);
app.use('/api/servers/:id/worlds',      worldRoutes);
app.use('/api/servers/:id/schedules',   scheduleRoutes);
app.use('/api/servers/:id/webhooks',    webhookRoutes);
app.use('/api/metrics',                 metricsRoutes);
app.use('/api/users',                   userRouter);
app.use('/api/permissions',             permissionRouter);
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
    const body = { error: err.message };
    if (err.code) body.code = err.code;
    return res.status(err.statusCode).json(body);
  }

  console.error('[YAMS] Unexpected error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

// Ensure DB is initialized (runs migration) before accepting connections
getDb();

// Seed the first admin user from env vars if no users exist yet.
// Runs asynchronously; the HTTP server starts in parallel — the window
// before the seed completes is milliseconds on first boot only.
const { seedAdmin } = require('./src/services/authService');
seedAdmin().catch(err => console.error('[YAMS] Admin seed failed:', err));

// Capture the http.Server so we can attach the WebSocket server to it.
// Both HTTP and WS share the same port — no separate WS_PORT needed.
const BIND   = process.env.BIND_ADDRESS || '127.0.0.1';
const server = app.listen(PORT, BIND, () => {
  console.log(`[YAMS] Running on http://localhost:${PORT}`);
  console.log('[YAMS] Endpoints:');
  console.log('  POST   /api/auth/login');
  console.log('  POST   /api/auth/refresh');
  console.log('  POST   /api/auth/logout');
  console.log('  POST   /api/auth/logout-all');
  console.log('  POST   /api/auth/register');
  console.log('  POST   /api/servers');
  console.log('  GET    /api/servers');
  console.log('  GET    /api/servers/:id');
  console.log('  DELETE /api/servers/:id');
  console.log('  POST   /api/servers/:id/start');
  console.log('  POST   /api/servers/:id/stop');
  console.log('  GET    /api/servers/:id/metrics');
  console.log('  GET    /api/servers/:id/files');
  console.log('  GET    /api/servers/:id/files/download?path=');
  console.log('  POST   /api/servers/:id/files/upload');
  console.log('  POST   /api/servers/:id/files/mkdir');
  console.log('  PUT    /api/servers/:id/files/rename');
  console.log('  DELETE /api/servers/:id/files');
  console.log('  POST   /api/servers/:id/backups');
  console.log('  GET    /api/servers/:id/backups');
  console.log('  GET    /api/servers/:id/backups/:backupId/download');
  console.log('  DELETE /api/servers/:id/backups/:backupId');
  console.log('  POST   /api/servers/:id/backups/:backupId/restore');
  console.log('  GET    /api/servers/:id/worlds');
  console.log('  GET    /api/servers/:id/worlds/:name');
  console.log('  POST   /api/servers/:id/worlds/active');
  console.log('  DELETE /api/servers/:id/worlds/:name');
  console.log('  POST   /api/servers/:id/worlds/import');
  console.log('  GET    /api/servers/:id/worlds/:name/export');
  console.log('  GET    /api/metrics');
  console.log(`  WS     ws://localhost:${PORT}/ws`);
  console.log(`  Docs   http://localhost:${PORT}/api-docs`);

  // Attach the WebSocket console server to the same HTTP server
  createWsServer(server);
});

module.exports = app;
