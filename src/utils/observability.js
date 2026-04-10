'use strict';

/**
 * Lightweight observability and metrics tracking.
 *
 * Provides real-time visibility into system state without external dependencies.
 * Called ad-hoc for debugging or can be exposed via a monitoring endpoint.
 */

// State is populated by serverService.js
let currentState = {
  activeServers: new Set(),
  activeClients: new Map(), // serverId → count
  pendingClients: new Map(), // serverId → count
  startTime: Date.now(),
};

/**
 * Update system state.
 * Called by serverService.js whenever state changes.
 *
 * @param {object} updates { activeServers, activeClients, pendingClients }
 */
function updateState(updates) {
  if (updates.activeServers !== undefined) {
    currentState.activeServers = updates.activeServers;
  }
  if (updates.activeClients !== undefined) {
    currentState.activeClients = updates.activeClients;
  }
  if (updates.pendingClients !== undefined) {
    currentState.pendingClients = updates.pendingClients;
  }
}

/**
 * Get current system observability data.
 * Useful for monitoring, debugging, or health checks.
 */
function getObservability() {
  const uptime = Date.now() - currentState.startTime;

  const activeClientsByServer = Array.from(currentState.activeClients.entries()).map(
    ([serverId, count]) => ({ serverId, activeClients: count })
  );

  const pendingClientsByServer = Array.from(currentState.pendingClients.entries()).map(
    ([serverId, count]) => ({ serverId, pendingClients: count })
  );

  return {
    uptime,
    stats: {
      activeServers: currentState.activeServers.size,
      totalActiveClients: Array.from(currentState.activeClients.values()).reduce((a, b) => a + b, 0),
      totalPendingClients: Array.from(currentState.pendingClients.values()).reduce((a, b) => a + b, 0),
    },
    breakdown: {
      activeClientsByServer,
      pendingClientsByServer,
    },
  };
}

module.exports = { updateState, getObservability };
