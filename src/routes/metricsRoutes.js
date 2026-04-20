'use strict';

const { Router } = require('express');
const { getObservability } = require('../utils/observability');
const { getMetricsSnapshot } = require('../services/serverService');

const router = Router();

// In-memory cache — avoids hammering the DB on every dashboard poll (every 3s).
// TTL is intentionally short so the dashboard stays near-real-time.
let cachedMetrics = null;
let lastUpdate = 0;
const CACHE_TTL = 2000; // ms

/**
 * GET /metrics
 *
 * Returns a snapshot of system state for the monitoring dashboard.
 * Aggregates data from three sources:
 *   1. serverService.getMetricsSnapshot() — live process state (clients, uptime, logs)
 *   2. observability.getObservability()   — system uptime (startTime is reliable)
 *   3. server list status counts          — derived from the DB snapshot in step 1
 *
 * Cached for CACHE_TTL ms. Stale cache is served on error to avoid dashboard outages.
 */
router.get('/', (req, res) => {
  try {
    const now = Date.now();

    if (cachedMetrics && (now - lastUpdate) < CACHE_TTL) {
      return res.json(cachedMetrics);
    }

    const obs = getObservability();
    const snap = getMetricsSnapshot();

    // Count status buckets from the DB snapshot.
    // Note: 'crashed' is never persisted to DB (schema only allows stopped/running),
    // so it will always be 0 — included for forward-compatibility with the client.
    const counts = { total: snap.serverList.length, running: 0, stopped: 0, crashed: 0 };
    for (const s of snap.serverList) {
      if (counts[s.status] !== undefined) counts[s.status]++;
      else counts.crashed++; // future-proof for any unexpected status value
    }

    // Collect recent activity: last 5 logs per server, sorted by time, capped at 20 globally.
    const recentLogs = snap.serverList
      .flatMap(s => (s.recentLogs || []).map(l => ({ ...l, serverName: s.name })))
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
      .slice(-20);

    const metrics = {
      uptime: obs.uptime,
      servers: {
        total: counts.total,
        running: counts.running,
        stopped: counts.stopped,
        crashed: counts.crashed,
        list: snap.serverList.map(s => ({
          id: s.id,
          name: s.name,
          status: s.status,
          port: s.port,
          clients: s.clients,
          uptime: s.uptime,
        })),
      },
      clients: {
        active: snap.totalActiveClients,
        pending: snap.totalPendingClients,
      },
      backpressure: {
        droppedMessages: snap.droppedMessages,
      },
      recentLogs,
    };

    cachedMetrics = metrics;
    lastUpdate = now;
    res.json(metrics);
  } catch (err) {
    console.error('[YAMS] /metrics error:', err);
    // Serve stale cache on error so the dashboard keeps showing data
    if (cachedMetrics) return res.json(cachedMetrics);
    res.status(500).json({ error: 'Failed to collect metrics' });
  }
});

module.exports = router;
