'use strict';

const { getDb } = require('../db');

let stmts = null;

function getStmts() {
  if (!stmts) {
    const db = getDb();
    stmts = {
      findByServer: db.prepare(`SELECT * FROM webhooks WHERE server_id = ? ORDER BY created_at ASC`),
      findById:     db.prepare(`SELECT * FROM webhooks WHERE id = ?`),
      insert:       db.prepare(`INSERT INTO webhooks (id, server_id, url, events, secret, enabled) VALUES (?, ?, ?, ?, ?, ?)`),
      update:       db.prepare(`UPDATE webhooks SET url = ?, events = ?, secret = ?, enabled = ? WHERE id = ?`),
      remove:       db.prepare(`DELETE FROM webhooks WHERE id = ?`),
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

function create({ id, serverId, url, events, secret = null, enabled = true }) {
  getStmts().insert.run(id, serverId, url, events, secret, enabled ? 1 : 0);
  return findById(id);
}

function update(id, { url, events, secret, enabled }) {
  getStmts().update.run(url, events, secret ?? null, enabled ? 1 : 0, id);
  return findById(id);
}

function remove(id) {
  getStmts().remove.run(id);
}

module.exports = { findByServer, findById, create, update, remove };
