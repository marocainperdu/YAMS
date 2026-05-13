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
const fsp  = require('fs/promises');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { v4: uuidv4 } = require('uuid');

const serverModel = require('../models/serverModel');
const fileManager = require('../utils/fileManager');
const { badRequest, notFound, conflict, internal } = require('../utils/errors');
const logPersist = require('../utils/logPersist');
const observability = require('../utils/observability');

// Root directory where all server folders live — overridable via env var (used by tests)
const SERVERS_ROOT = process.env.YAMS_SERVERS_ROOT || path.join(__dirname, '..', '..', 'servers');

// ─── Configuration ──────────────────────────────────────────────────────────
// Maximum number of log lines to buffer per server (configurable via env)
const LOG_BUFFER_SIZE = process.env.LOG_BUFFER_SIZE ? parseInt(process.env.LOG_BUFFER_SIZE, 10) : 100;

// Maximum time (ms) a client can wait in pending state before being disconnected (5 minutes)
const PENDING_CLIENT_TIMEOUT_MS = process.env.PENDING_CLIENT_TIMEOUT_MS ? parseInt(process.env.PENDING_CLIENT_TIMEOUT_MS, 10) : 5 * 60 * 1000;

// Maximum buffered bytes (ws.bufferedAmount) before we stop sending logs to a client
// This prevents slow clients from causing memory bloat in the server.
const BACKPRESSURE_BUFFER_LIMIT = 1_000_000; // 1 MB

// Event emitter for decoupling service from WebSocket transport.
// wsServer listens to these events instead of the service directly managing clients.
const streamEmitter = new EventEmitter();

// ─── Crash Classification ────────────────────────────────────────────────────
// When a server stops, classify the reason based on exit code and error context
const CRASH_CLASSIFY = {
  NORMAL_STOP: 'normal',      // Exit code 0 — user sent stop command
  UNEXPECTED_CRASH: 'crashed', // Exit code != 0 or error event without stop command
  STARTUP_FAILURE: 'startup',  // Error before process could fully start
};

/**
 * Map<serverId, { child: ChildProcess, name: string, clients: Set<WebSocket>,
 *                 logs: [], stopping: boolean, startedAt: number }>
 * Only populated for servers whose process is currently alive.
 * `stopping` flag is set when we initiate a stop (to distinguish from crashes).
 * `startedAt` is epoch ms used to compute per-server uptime in /metrics.
 */
const processes = new Map();

// Global count of log messages dropped due to client backpressure.
// Incremented in broadcastToClients(); read by getMetricsSnapshot().
let droppedMessages = 0;

// WebSocket.OPEN value per the WS spec (avoids importing `ws` here just for the constant)
const WS_OPEN = 1;

/**
 * Broadcast a JSON message to every WebSocket client subscribed to a server.
 * Applies backpressure: skips clients with large buffered amounts to prevent OOM.
 * Tracks dropped messages per client for observability.
 * @param {string} id   Server UUID
 * @param {object} msg  Object that will be JSON-serialised before sending
 */
function broadcastToClients(id, msg) {
  const entry = processes.get(id);
  if (!entry || entry.clients.size === 0) return;
  const json = JSON.stringify(msg);
  for (const ws of entry.clients) {
    if (ws.readyState === WS_OPEN && ws.bufferedAmount < BACKPRESSURE_BUFFER_LIMIT) {
      ws.send(json);
    } else if (ws.readyState === WS_OPEN && !ws.metadata) {
      ws.metadata = { droppedMessages: 1 };
      droppedMessages++;
    } else if (ws.readyState === WS_OPEN && ws.metadata) {
      ws.metadata.droppedMessages = (ws.metadata.droppedMessages || 0) + 1;
      droppedMessages++;
    }
  }
}

/**
 * Map<serverId, Set<WebSocket>>
 * Clients that subscribed while the server was stopped — flushed into the
 * active `clients` Set the moment the server process starts.
 * NOTE: To prevent memory leaks, each ws in pendingClients has a timeout attached
 * via ws.pendingTimeout; see subscribe() for details.
 */
const pendingClients = new Map();

/**
 * Single write path for all stdout/stderr output from child processes.
 * Appends to the server's ring buffer then fans out to every active client.
 *
 * NOTE: duplicate listener risk — each startServer() call spawns a fresh
 * ChildProcess; listeners are attached to the new child's streams, never to
 * an already-listening stream.  The `processes.has(id)` guard at the top of
 * startServer() prevents two calls from racing on the same server id.
 *
 * @param {string}            id    Server UUID (key in the processes Map)
 * @param {'stdout'|'stderr'} type  Which stream the data came from
 * @param {string}            data  Raw text chunk from the child process
 */
function pushLog(id, type, data) {
  const entry = processes.get(id);
  if (!entry) return;

  const msg = { type, serverId: id, timestamp: Date.now(), data };

  // Ring buffer — drop the oldest line once capacity is reached
  entry.logs.push(msg);
  if (entry.logs.length > LOG_BUFFER_SIZE) entry.logs.shift();

  // Emit event for event-driven subscribers (wsServer listens)
  streamEmitter.emit('log', { serverId: id, type, data, timestamp: msg.timestamp });

  // Persist to disk (non-blocking)
  const server = serverModel.findById(id);
  if (server) {
    logPersist.queueLog(id, server.path, `[${new Date(msg.timestamp).toISOString()}] ${type.toUpperCase()}: ${data}`);
  }

  broadcastToClients(id, msg);
}

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

  // Block start while a restore is extracting files — stopServer() sets DB to
  // 'stopped' before the JVM exits, so the guard above cannot detect this window.
  // Lazy-require avoids the circular dependency (backupService ↔ serverService).
  const { isRestoring } = require('./backupService');
  if (isRestoring(id)) {
    throw conflict(`Server '${server.name}' has a restore in progress`);
  }

  // Path traversal guard: ensure the server directory is inside SERVERS_ROOT.
  // Prevents a crafted DB entry from escaping the container's data directory.
  const resolvedPath = path.resolve(server.path);
  const resolvedRoot = path.resolve(SERVERS_ROOT);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(resolvedRoot + path.sep)) {
    throw badRequest(`Server path escapes SERVERS_ROOT — refusing to start`);
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
  // (attached immediately below) has a consistent Map entry to clean up.
  // `clients` starts empty and is populated via subscribe().
  // `logs` is the ring buffer replayed to late-joining clients.
  // `stopping` tracks whether we initiated the stop (vs a crash).
  processes.set(id, { child, name: server.name, clients: new Set(), logs: [], stopping: false, startedAt: Date.now() });

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

  // stdout: pipe to YAMS process stdout for local visibility, and push to the
  // ring buffer + broadcast to all subscribed WS clients via pushLog.
  child.stdout.on('data', (data) => {
    const line = data.toString();
    process.stdout.write(`[${server.name}] ${line}`);
    pushLog(id, 'stdout', line);
  });

  // stderr: same pipeline, tagged 'stderr' so clients can style or filter it.
  child.stderr.on('data', (data) => {
    const line = data.toString();
    process.stderr.write(`[${server.name}] ERROR: ${line}`);
    pushLog(id, 'stderr', line);
  });

  // Handles both graceful shutdown and unexpected crashes.
  // Entry is still in Map here only when the process exits on its own (crash,
  // OOM, etc.).  stopServer() removes the entry before signalling the process,
  // so a clean API-driven stop does NOT reach this branch.
  child.on('exit', (code, signal) => {
    const entry = processes.get(id);
    if (entry) {
      // Classify the exit: was this a deliberate stop or unexpected crash?
      let classification = CRASH_CLASSIFY.NORMAL_STOP;
      if (entry.stopping === false && (code !== 0 || signal)) {
        classification = CRASH_CLASSIFY.UNEXPECTED_CRASH;
      }

      // Emit status event for all subscribers
      streamEmitter.emit('status', {
        serverId: id,
        state: classification,
        exitCode: code,
        signal: signal,
        timestamp: Date.now(),
      });

      // Notify clients before clearing the entry so broadcastToClients can still find them
      broadcastToClients(id, { type: 'status', serverId: id, timestamp: Date.now(), data: classification });

      // Flush pending logs to disk before cleanup
      logPersist.flushNow(id, server.path);

      processes.delete(id);
      serverModel.updateStatus(id, 'stopped', null);
      console.log(
        `[YAMS] Server '${server.name}' exited (${classification}) — code: ${code ?? 'null'}, signal: ${signal ?? 'null'}`
      );
    }
  });

  // Handles OS-level spawn errors (ENOENT, EACCES, etc.)
  child.on('error', (err) => {
    console.error(`[YAMS] Spawn error for server '${server.name}': ${err.message}`);

    // Emit error event for subscribers
    streamEmitter.emit('error', {
      serverId: id,
      error: err.message,
      context: 'startup',
      timestamp: Date.now(),
    });

    broadcastToClients(id, { type: 'status', serverId: id, timestamp: Date.now(), data: CRASH_CLASSIFY.STARTUP_FAILURE });
    processes.delete(id);
    serverModel.updateStatus(id, 'stopped', null);
  });

  // Promote any WS clients that subscribed while this server was stopped.
  // Now that the process is live and handlers are attached, move them from
  // pendingClients into the active clients Set and tell them it started.
  const pendingSet = pendingClients.get(id);
  if (pendingSet && pendingSet.size > 0) {
    const entry = processes.get(id);
    for (const ws of pendingSet) {
      if (ws.readyState === WS_OPEN) {
        // Clear the pending timeout now that the server has started
        if (ws.pendingTimeout) {
          clearTimeout(ws.pendingTimeout);
          ws.pendingTimeout = null;
        }
        entry.clients.add(ws);
      }
    }
    pendingClients.delete(id);

    // Emit started event
    streamEmitter.emit('status', {
      serverId: id,
      state: 'started',
      timestamp: Date.now(),
    });

    // Notify all promoted clients (buffer is empty at this point — server just started)
    broadcastToClients(id, { type: 'status', serverId: id, timestamp: Date.now(), data: 'started', server: server.name });
    console.log(`[YAMS] Promoted ${pendingSet.size} pending WS client(s) for server '${server.name}'`);
  }

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

    // Mark that we're intentionally stopping (so exit handler knows it's not a crash)
    entry.stopping = true;

    // Emit stop event for subscribers
    streamEmitter.emit('status', {
      serverId: id,
      state: 'stopping',
      timestamp: Date.now(),
    });

    // Notify clients BEFORE removing from Map so broadcastToClients can still
    // find the entry.  The stop signal follows immediately after.
    broadcastToClients(id, { type: 'status', serverId: id, timestamp: Date.now(), data: CRASH_CLASSIFY.NORMAL_STOP });

    // Remove from Map so the exit handler does not do a redundant DB update
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

// ---------------------------------------------------------------------------
// WebSocket client management
// All subscription state lives here, co-located with the processes Map.
// wsServer.js calls these functions; it never touches processes or pendingClients directly.
// ---------------------------------------------------------------------------

/**
 * Subscribe a WebSocket client to a server's console stream.
 *
 * Three possible outcomes:
 *   { status: 'subscribed', serverName, logs }  — server is running; `logs` is the
 *                                                  buffered history to replay immediately.
 *   { status: 'pending',    serverName }         — server exists but is stopped; client
 *                                                  is queued and gets promoted automatically
 *                                                  when startServer() is called next.
 *   false                                         — serverId not found in DB.
 *
 * Idempotent for the same (serverId, ws) pair — Set.add() is a no-op for duplicates.
 *
 * PENDING TIMEOUT: If a client stays pending after PENDING_CLIENT_TIMEOUT_MS,
 * it is unsubscribed and its WebSocket should be closed by wsServer.
 *
 * @param {string}        serverId
 * @param {import('ws')} ws
 */
function subscribe(serverId, ws) {
  const server = serverModel.findById(serverId);
  if (!server) return false;

  const entry = processes.get(serverId);
  if (entry) {
    entry.clients.add(ws);
    // Clear any pending timeout if this ws was previously in pending state
    if (ws.pendingTimeout) clearTimeout(ws.pendingTimeout);
    // Return a shallow copy of the buffer so the caller can replay it
    return { status: 'subscribed', serverName: server.name, logs: [...entry.logs] };
  }

  // Server is stopped — queue the client; it will be promoted in startServer()
  if (!pendingClients.has(serverId)) pendingClients.set(serverId, new Set());
  pendingClients.get(serverId).add(ws);

  // Attach a timeout to prevent memory leaks if server never starts.
  // wsServer will receive 'pending_timeout' event and should close the connection.
  ws.pendingTimeout = setTimeout(() => {
    unsubscribe(serverId, ws);
    streamEmitter.emit('pending_timeout', serverId, ws);
  }, PENDING_CLIENT_TIMEOUT_MS);

  return { status: 'pending', serverName: server.name };
}

/**
 * Remove a WebSocket client from both active subscribers and the pending queue.
 * Clears any pending timeout to prevent dangling timer references.
 * Safe to call after the server has stopped (no-op if the client isn't tracked).
 *
 * @param {string}        serverId
 * @param {import('ws')} ws
 */
function unsubscribe(serverId, ws) {
  const entry = processes.get(serverId);
  if (entry) entry.clients.delete(ws);

  const pending = pendingClients.get(serverId);
  if (pending) {
    pending.delete(ws);
    // Clean up the Map entry when no more pending clients remain
    if (pending.size === 0) pendingClients.delete(serverId);
  }

  // Clear the pending timeout if this ws had one attached
  if (ws.pendingTimeout) {
    clearTimeout(ws.pendingTimeout);
    ws.pendingTimeout = null;
  }
}

/**
 * Write a command to a running server's stdin (appends "\n" automatically).
 * Throws an operational error if the server is not found or not running.
 * @param {string} serverId
 * @param {string} command  Raw Minecraft server command, e.g. "say hello"
 */
function sendCommand(serverId, command) {
  const server = serverModel.findById(serverId);
  if (!server) throw notFound(`Server '${serverId}' not found`);

  const entry = processes.get(serverId);
  if (!entry) throw conflict(`Server '${server.name}' is not running`);

  const { child } = entry;
  if (!child.stdin || child.stdin.destroyed) {
    throw internal(`Cannot write to stdin of '${server.name}' — stream is closed`);
  }

  // Minecraft's server reads one command per line from stdin
  child.stdin.write(`${command}\n`);
}

/**
 * Returns a safe, serialisable snapshot of current runtime state for /metrics.
 * Never exposes raw WebSocket objects or ChildProcess references.
 *
 * Computes client counts and per-server uptime directly from the live Maps so
 * the response is always accurate — observability.js updateState() is not wired
 * for client tracking, so we bypass it for those fields.
 */
function getMetricsSnapshot() {
  const allServers = serverModel.findAll();
  const now = Date.now();

  const serverList = allServers.map(s => {
    const entry = processes.get(s.id);
    const pendingSet = pendingClients.get(s.id);
    return {
      id: s.id,
      name: s.name,
      status: s.status,
      port: s.port,
      clients: entry ? entry.clients.size : 0,
      pendingClients: pendingSet ? pendingSet.size : 0,
      uptime: entry ? now - entry.startedAt : 0,
      // Last 5 log lines for the activity feed (already buffered in memory)
      recentLogs: entry ? entry.logs.slice(-5) : [],
    };
  });

  let totalActiveClients = 0;
  let totalPendingClients = 0;
  for (const [, entry] of processes) totalActiveClients += entry.clients.size;
  for (const [, set] of pendingClients) totalPendingClients += set.size;

  return { serverList, totalActiveClients, totalPendingClients, droppedMessages };
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

/**
 * Return the live ChildProcess for a running server, or null if not running.
 * Used by restoreBackup() to await the real OS-level process exit before
 * touching the filesystem — the DB status is not a reliable signal because
 * stopServer() writes 'stopped' before the JVM has actually exited.
 *
 * @param {string} serverId
 * @returns {import('child_process').ChildProcess | null}
 */
/**
 * Delete a server — removes the DB record and the server directory.
 * Requires the server to be stopped.
 * @param {string} id
 */
async function deleteServer(id) {
  const server = getServer(id);
  if (processes.has(id)) throw conflict('Stop the server before deleting it', 'SERVER_RUNNING');
  serverModel.remove(id);
  await fsp.rm(server.path, { recursive: true, force: true }).catch(err => {
    console.error(`[YAMS] Could not remove server directory: ${err.message}`);
  });
  return server;
}

function getChildProcess(serverId) {
  const entry = processes.get(serverId);
  return entry ? entry.child : null;
}

module.exports = {
  createServer, startServer, stopServer, deleteServer, listServers, getServer,
  subscribe, unsubscribe, sendCommand,
  getChildProcess,
  streamEmitter,
  getObservability: observability.getObservability,
  getMetricsSnapshot,
  LOG_BUFFER_SIZE,
  PENDING_CLIENT_TIMEOUT_MS,
  BACKPRESSURE_BUFFER_LIMIT,
  CRASH_CLASSIFY,
};
