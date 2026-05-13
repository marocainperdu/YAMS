'use strict';

/**
 * Emit a structured security event to stdout/stderr.
 *
 * All security-relevant events (auth failures, RBAC denials, dangerous uploads,
 * destructive operations) go through this function so they share a consistent
 * format and can be aggregated by any log pipeline (e.g. Loki, Datadog).
 *
 * @param {'info'|'warn'|'error'} level
 * @param {string}  event   Machine-readable event name  (e.g. 'auth.failed')
 * @param {object}  fields  Contextual data — at minimum { ip }.  Never include
 *                          secrets (tokens, passwords) or full filesystem paths.
 */
function securityLog(level, event, fields = {}) {
  const record = JSON.stringify({
    ts:    new Date().toISOString(),
    level,
    event,
    ...fields,
  });
  (level === 'error' ? console.error : console.log)('[YAMS:security]', record);
}

module.exports = { securityLog };
