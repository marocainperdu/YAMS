'use strict';

/**
 * Non-blocking log persistence utility.
 *
 * Writes server logs to disk in append mode without blocking the event loop.
 * Uses a simple queue to batch writes and avoid O(n) filesystem calls.
 *
 * All I/O happens asynchronously; callers never wait.
 */

const fs = require('fs');
const path = require('path');

// Per-server write queue: Map<serverId, Array<string>>
const writeQueues = new Map();

// Per-server flush timeout: Map<serverId, timeout ID>
const flushTimeouts = new Map();

const FLUSH_INTERVAL_MS = 1000; // Batch writes every 1 second

/**
 * Queue a log line for persistent storage.
 * The line is added to a queue and written to disk in batches (non-blocking).
 *
 * @param {string} serverId   Server UUID
 * @param {string} serverPath Path to server directory
 * @param {string} line       Raw log line (will be newline-terminated on disk)
 */
function queueLog(serverId, serverPath, line) {
  if (!writeQueues.has(serverId)) {
    writeQueues.set(serverId, []);
  }

  writeQueues.get(serverId).push(line);

  // Schedule a flush if not already scheduled
  if (!flushTimeouts.has(serverId)) {
    const timeoutId = setTimeout(() => {
      flushLogs(serverId, serverPath);
    }, FLUSH_INTERVAL_MS);
    flushTimeouts.set(serverId, timeoutId);
  }
}

/**
 * Flush queued logs to disk.
 * Called automatically every FLUSH_INTERVAL_MS, or manually to force a write.
 *
 * @param {string} serverId    Server UUID
 * @param {string} serverPath  Path to server directory
 */
function flushLogs(serverId, serverPath) {
  const queue = writeQueues.get(serverId);
  if (!queue || queue.length === 0) return;

  // Clear the timeout since we're flushing
  const timeoutId = flushTimeouts.get(serverId);
  if (timeoutId) {
    clearTimeout(timeoutId);
    flushTimeouts.delete(serverId);
  }

  // Grab the queue and reset it
  writeQueues.delete(serverId);
  const lines = queue;

  // Non-blocking write: append all lines to the log file
  const logPath = path.join(serverPath, 'logs', 'latest.log');
  const logDir = path.dirname(logPath);

  // Ensure logs directory exists (best-effort, non-blocking)
  fs.mkdir(logDir, { recursive: true }, (mkdirErr) => {
    if (mkdirErr && mkdirErr.code !== 'EEXIST') {
      console.error(`[YAMS] Failed to create logs directory for server ${serverId}: ${mkdirErr.message}`);
      return;
    }

    // Write all queued lines at once (more efficient than N separate writes)
    const content = lines.map((line) => `${line}\n`).join('');
    fs.appendFile(logPath, content, 'utf8', (err) => {
      if (err) {
        // Log to stderr but don't crash — persistence is nice-to-have, not critical
        console.error(`[YAMS] Failed to persist logs for server ${serverId}: ${err.message}`);
      }
    });
  });
}

/**
 * Force a flush for a specific server (e.g., when stopping).
 * Called to ensure all logs are written before server exits.
 *
 * @param {string} serverId   Server UUID
 * @param {string} serverPath Path to server directory
 */
function flushNow(serverId, serverPath) {
  const timeoutId = flushTimeouts.get(serverId);
  if (timeoutId) {
    clearTimeout(timeoutId);
    flushTimeouts.delete(serverId);
  }
  flushLogs(serverId, serverPath);
}

module.exports = { queueLog, flushNow };
