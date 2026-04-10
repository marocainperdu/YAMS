'use strict';

/**
 * Business logic + process management for Minecraft servers.
 *
 * TWO sources of truth:
 *   - `processes` Map  → live ChildProcess objects (in memory, lost on restart)
 *   - SQLite DB        → configuration + persisted status/pid (survives restarts)
 *
 * Invariant: after every operation the Map and DB must agree on status/pid.
 */

const path = require('path');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const serverModel = require('../models/serverModel');
const fileManager = require('../utils/fileManager');
const { badRequest, notFound, conflict, internal } = require('../utils/errors');

// Root directory where all server folders live — overridable via env var (used by tests)
const SERVERS_ROOT = process.env.YAMS_SERVERS_ROOT || path.join(__dirname, '..', '..', 'servers');

/**
 * Map<serverId, { child: ChildProcess, name: string }>
 * Only populated for servers whose process is currently alive.
 */
const processes = new Map();

// ---------------------------------------------------------------------------
// Startup reconciliation
// On process restart the Map is empty, but DB might still show status=running
// from a previous session that crashed. Reset those records to stopped.
// ---------------------------------------------------------------------------
(function reconcileOnStartup() {
  const { getDb } = require('../db');
  const db = getDb();
  const result = db
    .prepare("UPDATE servers SET status = 'stopped', pid = NULL WHERE status = 'running'")
    .run();

  if (result.changes > 0) {
    console.log(`[YAMS] Reconciled ${result.changes} stale running server(s) to stopped on startup`);
  }
})();

// ---------------------------------------------------------------------------
// Input validation helpers
// ---------------------------------------------------------------------------

/** Valid: alphanumeric and hyphens, 3–32 chars, must start with a letter */
function validateName(name) {
  if (typeof name !== 'string' || !/^[a-zA-Z][a-zA-Z0-9\-]{2,31}$/.test(name)) {
    throw badRequest(
      'name must be 3–32 characters, start with a letter, and contain only letters, digits, and hyphens'
    );
  }
}

/** Valid: integer between 1024 and 65535 */
function validatePort(port) {
  const p = Number(port);
  if (!Number.isInteger(p) || p < 1024 || p > 65535) {
    throw badRequest('port must be an integer between 1024 and 65535');
  }
  return p;
}

/** Valid: e.g. "512M", "1G", "2G" */
function validateRam(ram) {
  if (typeof ram !== 'string' || !/^\d+(M|G)$/i.test(ram)) {
    throw badRequest("ram must be in format like '512M' or '2G'");
  }
  // Normalize to uppercase suffix
  return ram.toUpperCase();
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

/**
 * Create a new server: validate → check conflicts → create files → save to DB.
 * @param {{ name: string, port: number|string, ram: string }} params
 * @returns {object} The created server record
 */
function createServer({ name, port, ram = '1G' }) {
  // 1. Validate inputs first — no side effects yet
  validateName(name);
  const validPort = validatePort(port);
  const validRam = validateRam(ram);

  // 2. Check for conflicts in DB
  if (serverModel.findByPort(validPort)) {
    throw conflict(`Port ${validPort} is already in use by another server`);
  }
  if (serverModel.findByName(name)) {
    throw conflict(`A server named '${name}' already exists`);
  }

  const serverPath = path.join(SERVERS_ROOT, name);

  // 3. Disk operations — do these before writing to DB so we don't end up
  //    with a DB record for a server whose directory creation failed
  try {
    fileManager.createServerDirectory(serverPath);
    fileManager.writeEula(serverPath);
    fileManager.writeServerProperties(serverPath, { port: validPort, name });
  } catch (err) {
    // Best-effort cleanup: the directory might be partially created
    // We don't try to delete it — leave it for the user to inspect
    throw internal(`Failed to create server directory: ${err.message}`);
  }

  // 4. Persist to DB
  const server = serverModel.create({
    id: uuidv4(),
    name,
    path: serverPath,
    port: validPort,
    ram: validRam,
  });

  console.log(`[YAMS] Created server '${name}' at ${serverPath}`);
  return server;
}

/**
 * Start a server: validate state → check jar → spawn → track process.
 * @param {string} id Server UUID
 * @returns {object} Updated server record
 */
function startServer(id) {
  const server = serverModel.findById(id);
  if (!server) throw notFound(`Server '${id}' not found`);

  // Double-check both the DB state and the live Map
  if (processes.has(id) || server.status === 'running') {
    throw conflict(`Server '${server.name}' is already running`);
  }

  // server.jar must be present before we attempt to spawn
  if (!fileManager.serverJarExists(server.path)) {
    throw badRequest(
      `server.jar not found. Place a Minecraft server JAR at: ${path.join(server.path, 'server.jar')}`
    );
  }

  // Build JVM arguments
  const jvmArgs = [
    `-Xms${server.ram}`,
    `-Xmx${server.ram}`,
    '-jar',
    'server.jar',
    '--nogui',
  ];

  let child;
  try {
    child = spawn('java', jvmArgs, {
      cwd: server.path,
      // Keep stdin open so we can send commands (e.g. 'stop') to the server
      stdio: ['pipe', 'pipe', 'pipe'],
      // Do NOT detach — we want the child tied to this process's lifetime
      detached: false,
    });
  } catch (err) {
    throw internal(`Failed to spawn java process: ${err.message}`);
  }

  // If spawn() itself fails synchronously (e.g. java not found), child.pid is undefined
  if (child.pid === undefined) {
    throw internal(
      'java process failed to start. Make sure Java is installed and available in PATH.'
    );
  }

  // Register process in memory BEFORE updating DB so the exit handler
  // (attached immediately below) has a consistent Map entry to clean up
  processes.set(id, { child, name: server.name });

  // Update DB to reflect running state
  try {
    serverModel.updateStatus(id, 'running', child.pid);
  } catch (err) {
    // DB write failed after spawn — kill the orphaned process and clean up
    processes.delete(id);
    child.kill();
    throw internal(`Started java but failed to save state to DB: ${err.message}`);
  }

  // --- Process lifecycle event handlers ---

  // Pipe server stdout/stderr to the YAMS process stdout so logs are visible
  child.stdout.on('data', (data) => {
    process.stdout.write(`[${server.name}] ${data}`);
  });

  child.stderr.on('data', (data) => {
    process.stderr.write(`[${server.name}] ERROR: ${data}`);
  });

  // Handles both graceful shutdown and unexpected crashes
  child.on('exit', (code, signal) => {
    const wasInMap = processes.has(id);
    processes.delete(id);

    // Only update DB if we haven't already cleaned up (e.g. via stopServer)
    if (wasInMap) {
      serverModel.updateStatus(id, 'stopped', null);
      console.log(
        `[YAMS] Server '${server.name}' exited — code: ${code ?? 'null'}, signal: ${signal ?? 'null'}`
      );
    }
  });

  // Handles OS-level spawn errors (ENOENT, EACCES, etc.)
  child.on('error', (err) => {
    console.error(`[YAMS] Spawn error for server '${server.name}': ${err.message}`);
    processes.delete(id);
    serverModel.updateStatus(id, 'stopped', null);
  });

  console.log(`[YAMS] Started server '${server.name}' (PID: ${child.pid})`);
  return serverModel.findById(id);
}

/**
 * Stop a running server.
 *
 * Strategy:
 *   1. Try to send the 'stop' command via stdin (graceful Minecraft shutdown).
 *   2. If stdin write fails or process is not in Map, fall back to child.kill().
 *
 * Note on Windows: child.kill() calls TerminateProcess() (hard kill). The 'stop'
 * command via stdin is the preferred graceful path and works on all platforms.
 *
 * @param {string} id Server UUID
 * @returns {object} Updated server record
 */
function stopServer(id) {
  const server = serverModel.findById(id);
  if (!server) throw notFound(`Server '${id}' not found`);

  const entry = processes.get(id);

  if (!entry && server.status !== 'running') {
    throw conflict(`Server '${server.name}' is not running`);
  }

  if (entry) {
    const { child } = entry;

    // Remove from Map FIRST to prevent the exit handler from doing a
    // redundant DB update after we update it ourselves below
    processes.delete(id);

    // Attempt graceful shutdown via Minecraft's built-in 'stop' command
    let gracefulSent = false;
    if (child.stdin && !child.stdin.destroyed) {
      try {
        child.stdin.write('stop\n');
        child.stdin.end();
        gracefulSent = true;
        console.log(`[YAMS] Sent 'stop' command to server '${server.name}'`);
      } catch (err) {
        console.warn(`[YAMS] Could not write to stdin of '${server.name}': ${err.message}`);
      }
    }

    // Hard kill as fallback if graceful send failed
    if (!gracefulSent) {
      child.kill(); // SIGTERM on Unix, TerminateProcess on Windows
      console.log(`[YAMS] Sent kill signal to server '${server.name}' (PID: ${child.pid})`);
    }
  }

  // Update DB regardless — even if the process wasn't in the Map
  // (handles edge case where process was running per DB but not tracked)
  serverModel.updateStatus(id, 'stopped', null);

  return serverModel.findById(id);
}

/** @returns {object[]} All servers from DB */
function listServers() {
  return serverModel.findAll();
}

/**
 * @param {string} id
 * @returns {object} Server record
 */
function getServer(id) {
  const server = serverModel.findById(id);
  if (!server) throw notFound(`Server '${id}' not found`);
  return server;
}

module.exports = { createServer, startServer, stopServer, listServers, getServer };
