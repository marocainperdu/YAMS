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
      insert:         db.prepare(`INSERT INTO schedules (id, server_id, name, cron, command, enabled) VALUES (?, ?, ?, ?, ?, ?)`),
      update:         db.prepare(`UPDATE schedules SET name = ?, cron = ?, command = ?, enabled = ? WHERE id = ?`),
      touch:          db.prepare(`UPDATE schedules SET last_run_at = datetime('now') WHERE id = ?`),
      remove:         db.prepare(`DELETE FROM schedules WHERE id = ?`),
    };
  }
  return stmts;
}

function findByServer(serverId) {
  return getStmts().findByServer.all(serverId);
}

function findById(id) {
  return getStmts().findById.get(id) ?? null;
}

function findAllEnabled() {
  return getStmts().findAllEnabled.all();
}

function create({ id, serverId, name, cron, command, enabled = true }) {
  getStmts().insert.run(id, serverId, name, cron, command, enabled ? 1 : 0);
  return findById(id);
}

function update(id, { name, cron, command, enabled }) {
  getStmts().update.run(name, cron, command, enabled ? 1 : 0, id);
  return findById(id);
}

function touch(id) {
  getStmts().touch.run(id);
}

function remove(id) {
  getStmts().remove.run(id);
}

module.exports = { findByServer, findById, findAllEnabled, create, update, touch, remove };
