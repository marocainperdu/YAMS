'use strict';

/**
 * YAMS — Yet Another Minecraft Server Manager
 * Entry point: configures Express, mounts routes, starts HTTP listener.
 */

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const swaggerUi = require('swagger-ui-express');

// DB singleton init + schema migration
// serverService triggers reconcileOnStartup() on require
const { getDb } = require('./src/db');
require('./src/services/serverService');
require('./src/services/metricsService').init();

const serverRoutes  = require('./src/routes/serverRoutes');
const fileRoutes    = require('./src/routes/fileRoutes');
const backupRoutes  = require('./src/routes/backupRoutes');
const worldRoutes   = require('./src/routes/worldRoutes');
const metricsRoutes = require('./src/routes/metricsRoutes');
const authRoutes    = require('./src/routes/authRoutes');
const { userRouter, permissionRouter } = require('./src/routes/userRoutes');
const { seedAdminIfEmpty } = require('./src/services/authService');
const swaggerSpec = require('./src/swagger');
const { createWsServer } = require('./src/websocket/wsServer');

const app  = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use(express.json());

app.use((req, _res, next) => {
  console.log(`[YAMS] ${req.method} ${req.path}`);
  next();
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.use('/auth',        authRoutes);
app.use('/users',       userRouter);
app.use('/permissions', permissionRouter);
app.use('/servers',            serverRoutes);
app.use('/servers/:id/files',   fileRoutes);
app.use('/servers/:id/backups', backupRoutes);
app.use('/servers/:id/worlds',  worldRoutes);
app.use('/metrics', metricsRoutes);

// /api/* mirrors for the built React frontend
app.use('/api/auth',        authRoutes);
app.use('/api/users',       userRouter);
app.use('/api/permissions', permissionRouter);
app.use('/api/servers',            serverRoutes);
app.use('/api/servers/:id/files',   fileRoutes);
app.use('/api/servers/:id/backups', backupRoutes);
app.use('/api/servers/:id/worlds',  worldRoutes);
app.use('/api/metrics', metricsRoutes);

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ---------------------------------------------------------------------------
// Error handlers (must be after all routes)
// ---------------------------------------------------------------------------

const DIST_DIR   = path.join(__dirname, 'client', 'dist');
const INDEX_HTML = path.join(DIST_DIR, 'index.html');
if (fs.existsSync(INDEX_HTML)) {
  app.use(express.static(DIST_DIR));
  app.get('*', (_req, res) => res.sendFile(INDEX_HTML));
}

app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

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

getDb();
seedAdminIfEmpty(); // no-op unless YAMS_AUTH_ENABLED=true

const server = app.listen(PORT, () => {
  console.log(`[YAMS] Running on http://localhost:${PORT}`);
  console.log('[YAMS] Endpoints:');
  console.log('  POST   /auth/login');
  console.log('  POST   /users                (admin)');
  console.log('  GET    /users                (admin)');
  console.log('  POST   /permissions          (admin)');
  console.log('  POST   /servers');
  console.log('  GET    /servers              (auth)');
  console.log('  GET    /servers/:id          (view)');
  console.log('  POST   /servers/:id/start    (start)');
  console.log('  POST   /servers/:id/stop     (stop)');
  console.log('  GET    /servers/:id/metrics  (view)');
  console.log('  GET    /servers/:id/files');
  console.log('  POST   /servers/:id/files/upload');
  console.log('  POST   /servers/:id/files/mkdir');
  console.log('  PUT    /servers/:id/files/rename');
  console.log('  DELETE /servers/:id/files');
  console.log('  POST   /servers/:id/backups');
  console.log('  GET    /servers/:id/backups');
  console.log('  GET    /servers/:id/backups/:backupId/download');
  console.log('  DELETE /servers/:id/backups/:backupId');
  console.log('  POST   /servers/:id/backups/:backupId/restore');
  console.log('  GET    /servers/:id/worlds');
  console.log('  GET    /servers/:id/worlds/:name');
  console.log('  POST   /servers/:id/worlds/active');
  console.log('  DELETE /servers/:id/worlds/:name');
  console.log('  POST   /servers/:id/worlds/import');
  console.log('  GET    /servers/:id/worlds/:name/export');
  console.log('  GET    /metrics');
  console.log(`  WS     ws://localhost:${PORT}/ws`);
  console.log(`  Docs   http://localhost:${PORT}/api-docs`);

  createWsServer(server);
});

module.exports = app;
