'use strict';

const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');

let stmts = null;

function getStmts() {
  if (!stmts) {
    const db = getDb();
    stmts = {
      upsert: db.prepare(`
        INSERT INTO server_permissions (id, user_id, server_id, permissions)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, server_id) DO UPDATE SET permissions = excluded.permissions
      `),
      findByUserAndServer: db.prepare(
        `SELECT * FROM server_permissions WHERE user_id = ? AND server_id = ?`
      ),
      findByUser: db.prepare(
        `SELECT * FROM server_permissions WHERE user_id = ?`
      ),
    };
  }
  return stmts;
}

function parse(row) {
  if (!row) return null;
  return { ...row, permissions: JSON.parse(row.permissions) };
}

function upsert({ userId, serverId, permissions }) {
  const permJson = typeof permissions === 'string'
    ? permissions
    : JSON.stringify(permissions);
  getStmts().upsert.run(uuidv4(), userId, serverId, permJson);
  return findByUserAndServer(userId, serverId);
}

function findByUserAndServer(userId, serverId) {
  return parse(getStmts().findByUserAndServer.get(userId, serverId));
}

function findByUser(userId) {
  return getStmts().findByUser.all(userId).map(parse);
}

module.exports = { upsert, findByUserAndServer, findByUser };
