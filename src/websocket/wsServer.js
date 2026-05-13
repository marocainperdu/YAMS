'use strict';

/**
 * YAMS WebSocket Server — real-time console for Minecraft servers.
 *
 * Attached to the Express HTTP server on path /ws (same port as the API).
 * No separate port is needed; the HTTP upgrade handshake is handled by Node's
 * built-in server, and ws routes it to this handler by path.
 *
 * ─── CLIENT → SERVER ────────────────────────────────────────────────────────
 *
 *   Subscribe (call this first, or again after a crash to re-subscribe):
 *     { "action": "subscribe", "serverId": "<uuid>" }
 *
 *   Send a command to the running server's stdin:
 *     { "action": "command", "serverId": "<uuid>", "command": "say hello" }
 *
 * ─── SERVER → CLIENT ────────────────────────────────────────────────────────
 *
 *   All messages carry:  { type, serverId?, timestamp, data }
 *
 *   Subscription accepted — server is running:
 *     { "type": "status", "serverId": "…", "timestamp": …, "data": "subscribed", "server": "name" }
 *
 *   Subscription accepted — server is currently stopped (client will wait):
 *     { "type": "status", "serverId": "…", "timestamp": …, "data": "pending",    "server": "name" }
 *
 *   Pending subscription resolved — server just started:
 *     { "type": "status", "serverId": "…", "timestamp": …, "data": "started",    "server": "name" }
 *
 *   Buffered log history replayed immediately after 'subscribed':
 *     { "type": "history", "serverId": "…", "timestamp": …, "data": [ <log entries> ] }
 *
 *   Live stdout line:
 *     { "type": "stdout", "serverId": "…", "timestamp": …, "data": "…" }
 *
 *   Live stderr line:
 *     { "type": "stderr", "serverId": "…", "timestamp": …, "data": "…" }
 *
 *   Server stopped or crashed:
 *     { "type": "status", "serverId": "…", "timestamp": …, "data": "stopped" }
 *
 *   Error feedback:
 *     { "type": "error", "timestamp": …, "data": "<reason>" }
 */

const WebSocket = require('ws');
const { subscribe, unsubscribe, sendCommand, streamEmitter, getObservability, CRASH_CLASSIFY } = require('../services/serverService');
const observability = require('../utils/observability');

// Mirrors the flag used by the HTTP middleware so WS auth is consistent.
const AUTH_ENABLED = process.env.YAMS_AUTH_ENABLED === 'true';
const jwt = AUTH_ENABLED ? require('jsonwebtoken') : null;

// Interval between server-side ping probes (ms).
// Clients that don't respond within this window are terminated.
const HEARTBEAT_INTERVAL_MS = 30_000;

// Error codes for programmatic client handling
const ERROR_CODES = {
  INVALID_JSON: 'INVALID_JSON',
  INVALID_MESSAGE: 'INVALID_MESSAGE',
  SERVER_NOT_FOUND: 'SERVER_NOT_FOUND',
  SERVER_NOT_RUNNING: 'SERVER_NOT_RUNNING',
  INVALID_COMMAND: 'INVALID_COMMAND',
  UNKNOWN_ACTION: 'UNKNOWN_ACTION',
};

/**
 * Attach the WebSocket server to an existing HTTP server on the /ws path.
 * Shares the same port as the Express HTTP API — no separate WS port needed.
 * Called once from app.js after app.listen().
 *
 * @param {import('http').Server} httpServer  The server returned by app.listen()
 * @returns {WebSocket.Server}
 */
function createWsServer(httpServer) {
  // noServer: true — we own the upgrade handshake so we can run auth before ws accepts.
  const wss = new WebSocket.Server({ noServer: true });

  // ── JWT upgrade guard ────────────────────────────────────────────────────────
  // Intercepts the HTTP→WS upgrade before ws completes the handshake.
  // Token is expected as a query param: ws://host/ws?token=<jwt>
  // When YAMS_AUTH_ENABLED is not 'true' the check is skipped entirely.
  httpServer.on('upgrade', (req, socket, head) => {
    // Filter to /ws only — destroy any upgrade attempt on other paths.
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    if (AUTH_ENABLED) {
      const token = url.searchParams.get('token') ?? '';
      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      try {
        req.wsUser = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
      } catch {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      if (req.wsUser) ws.user = req.wsUser; // available to all message handlers
      wss.emit('connection', ws, req);
    });
  });

  // ── Event listeners for service-level events ───────────────────────────────
  // Listen to server lifecycle events and stream them to connected clients.
  // This decouples the service layer from WebSocket specifics.

  streamEmitter.on('log', (logEvent) => {
    // Logs are already broadcast via pushLog()
    // This hook is available for future features (e.g., log filtering, metrics)
  });

  streamEmitter.on('status', (statusEvent) => {
    // Status events (started, crashed, normal, stopping) — already broadcast
    // Available for monitoring/metrics collection
  });

  streamEmitter.on('error', (errorEvent) => {
    console.error(`[YAMS] Error event from server ${errorEvent.serverId}: ${errorEvent.error}`);
  });

  // ── Event listeners ──────────────────────────────────────────────────────
  // Listen for pending clients that timeout while waiting for a server to start.
  // Close their connections to prevent zombie clients.
  streamEmitter.on('pending_timeout', (serverId, ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      send(ws, { type: 'error', code: 'PENDING_TIMEOUT', data: 'Subscription pending timeout — server did not start in time' });
      ws.close(4000, 'Pending client timeout');
    }
  });

  // ── Heartbeat ────────────────────────────────────────────────────────────
  // The `ws` library does not detect half-open TCP connections on its own.
  // We ping all clients on a fixed interval.  Clients that don't pong back
  // are terminated; their 'close' event fires normally so cleanup still runs.
  const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, HEARTBEAT_INTERVAL_MS);

  // Prevent the interval from keeping Node alive after an intentional close
  wss.on('close', () => clearInterval(pingInterval));

  // ── Per-connection logic ─────────────────────────────────────────────────
  wss.on('connection', (ws) => {
    // ── Connection metadata ──────────────────────────────────────────────────
    // Track metadata for debugging and monitoring
    ws.metadata = {
      connectionTime: Date.now(),
      lastPong: Date.now(),
      droppedMessages: 0,
      subscribedServerId: null,
    };

    // Reset alive flag on each pong so the heartbeat knows the client is healthy
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
      ws.metadata.lastPong = Date.now();
    });

    // Tracks the server this connection is subscribed to.
    // Stored here so the 'close' handler can clean up without another round-trip.
    let subscribedServerId = null;

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return send(ws, { type: 'error', code: ERROR_CODES.INVALID_JSON, data: 'Message must be valid JSON' });
      }

      switch (msg.action) {
        case 'subscribe':
          // Unsubscribe from any previous server first.
          // This lets clients re-subscribe after a crash, or switch to a different server,
          // without needing to reconnect the WebSocket.
          if (subscribedServerId) {
            unsubscribe(subscribedServerId, ws);
            subscribedServerId = null;
          }
          handleSubscribe(ws, msg, (id) => {
            subscribedServerId = id;
            ws.metadata.subscribedServerId = id;
            // Update observability: track this subscription
            updateObservabilityStats();
          });
          break;

        case 'command':
          handleCommand(ws, msg);
          break;

        default:
          send(ws, { type: 'error', code: ERROR_CODES.UNKNOWN_ACTION, data: `Unknown action: ${msg.action ?? '(none)'}` });
      }
    });

    // Remove the client from whatever Set it belongs to (active or pending)
    ws.on('close', () => {
      if (subscribedServerId) {
        unsubscribe(subscribedServerId, ws);
        subscribedServerId = null;
      }
      ws.metadata.subscribedServerId = null;
      // Update observability: this client disconnected
      updateObservabilityStats();
    });

    ws.on('error', (err) => {
      // Transport-level error — 'close' will fire after this, so cleanup still runs
      console.error('[YAMS WS] Client error:', err.message);
    });
  });

  wss.on('error', (err) => {
    console.error('[YAMS WS] Server error:', err.message);
  });

  console.log(`[YAMS] WebSocket console server attached on /ws (same port as HTTP)`);
  return wss;
}

// ── Action handlers ──────────────────────────────────────────────────────────

/**
 * Subscribe the client to a server's log stream.
 *
 * Outcomes:
 *   subscribed — server is running; buffered history is replayed immediately.
 *   pending    — server is stopped; client is queued and will receive a
 *                'started' push the moment the server process comes online.
 *   error      — serverId missing or not found in DB.
 *
 * @param {WebSocket}             ws
 * @param {{ serverId?: string }} msg
 * @param {(id: string) => void}  setId  Stores serverId in the connection closure
 */
function handleSubscribe(ws, msg, setId) {
  const { serverId } = msg;

  if (!serverId || typeof serverId !== 'string') {
    return send(ws, { type: 'error', code: ERROR_CODES.INVALID_MESSAGE, data: 'subscribe requires a serverId field' });
  }

  // subscribe() handles DB validation, active registration, and pending queuing
  const result = subscribe(serverId, ws);

  if (result === false) {
    return send(ws, { type: 'error', code: ERROR_CODES.SERVER_NOT_FOUND, data: `Server '${serverId}' not found` });
  }

  // Register in closure so the 'close' handler can clean up (active or pending)
  setId(serverId);

  if (result.status === 'subscribed') {
    send(ws, { type: 'status', serverId, data: 'subscribed', server: result.serverName });

    // Replay the ring buffer — client catches up on logs it missed before connecting
    if (result.logs.length > 0) {
      send(ws, { type: 'history', serverId, data: result.logs });
    }
    console.log(`[YAMS WS] Client subscribed to running server '${result.serverName}'`);
  } else {
    // status === 'pending': server is offline; client will wait
    send(ws, { type: 'status', serverId, data: 'pending', server: result.serverName });
    console.log(`[YAMS WS] Client queued for offline server '${result.serverName}'`);
  }
}

/**
 * Write a command to the server's stdin.
 * Validation (server exists, is running, stdin is open) happens in serverService.
 *
 * @param {WebSocket}                                    ws
 * @param {{ serverId?: string, command?: string }}       msg
 */
function handleCommand(ws, msg) {
  const { serverId, command } = msg;

  if (!serverId || typeof serverId !== 'string') {
    return send(ws, { type: 'error', code: ERROR_CODES.INVALID_MESSAGE, data: 'command requires a serverId field' });
  }
  if (!command || typeof command !== 'string' || command.trim() === '') {
    return send(ws, { type: 'error', code: ERROR_CODES.INVALID_COMMAND, data: 'command requires a non-empty command field' });
  }

  try {
    // sendCommand() appends "\n" and writes directly to the process stdin
    sendCommand(serverId, command.trim());
  } catch (err) {
    send(ws, { type: 'error', code: ERROR_CODES.SERVER_NOT_RUNNING, data: err.message });
  }
}

// ── Utility ──────────────────────────────────────────────────────────────────

/**
 * Update observability metrics based on service state.
 * Called whenever client connections change.
 */
function updateObservabilityStats() {
  // This is a simplified approach: compute stats from service exports
  const stats = getObservability();

  if (stats.stats.activeServers > 0 || stats.stats.totalActiveClients > 0) {
    console.log(
      `[YAMS] Active: ${stats.stats.activeServers} servers, ` +
      `${stats.stats.totalActiveClients} clients, ` +
      `${stats.stats.totalPendingClients} pending`
    );
  }
}

/**
 * Serialise and send a message to a single WebSocket client.
 * Automatically injects `timestamp` so callers don't have to remember it.
 * For error messages, expects a `code` field for programmatic handling.
 * No-ops silently if the socket is not in the OPEN state.
 *
 * @param {WebSocket} ws
 * @param {object}    msg  Must include `type`; if `type` is `error`, should also have `code`
 */
function send(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ timestamp: Date.now(), ...msg }));
  }
}

module.exports = { createWsServer };
