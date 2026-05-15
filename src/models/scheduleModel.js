'use strict';

const { getDb } = require('../db');

let stmts = null;

function getStmts() {
  if (!stmts) {
    const db = getDb();
    stmts = {
      findByServer:   db.prepare(`SELECT * FROM schedules WHERE server_id = ? ORDER BY created_at ASC`),
      findById:       db.prepare(`SELECT * FROM schedules WHERE id = ?`),
      findAllEnabled: db.prepare(`SELECT * FROM schedules WHERE enabled = 1`),
      insert:         db.prepare(`INSERT INTO schedules (id, server_id, name, type, cron, command, config, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
      update:         db.prepare(`UPDATE schedules SET name = ?, type = ?, cron = ?, command = ?, config = ?, enabled = ? WHERE id = ?`),
      touch:          db.prepare(`UPDATE schedules SET last_run_at = datetime('now') WHERE id = ?`),
      remove:         db.prepare(`DELETE FROM schedules WHERE id = ?`),
    };
  }
  return stmts;
}

function findByServer(serverId) {
  return getStmts().findByServer.all(serverId).map(_parse);
}

function findById(id) {
  return getStmts().findById.get(id) ?? null;
}

function findAllEnabled() {
  return getStmts().findAllEnabled.all().map(_parse);
}

function create({ id, serverId, name, type = 'command', cron, command, config = {}, enabled = true }) {
  const configStr = typeof config === 'string' ? config : JSON.stringify(config);
  getStmts().insert.run(id, serverId, name, type, cron, command ?? '', configStr, enabled ? 1 : 0);
  return _parse(findById(id));
}

function update(id, { name, type = 'command', cron, command, config = {}, enabled }) {
  const configStr = typeof config === 'string' ? config : JSON.stringify(config);
  getStmts().update.run(name, type, cron, command ?? '', configStr, enabled ? 1 : 0, id);
  return _parse(findById(id));
}

function _parse(row) {
  if (!row) return null;
  try { row.config = JSON.parse(row.config || '{}'); } catch { row.config = {}; }
  return row;
}

function touch(id) {
  getStmts().touch.run(id);
}

function remove(id) {
  getStmts().remove.run(id);
}

module.exports = { findByServer, findById, findAllEnabled, create, update, touch, remove };
