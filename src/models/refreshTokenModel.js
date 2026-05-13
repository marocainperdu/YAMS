'use strict';

const { getDb } = require('../db');

let stmts = null;

function getStmts() {
  if (!stmts) {
    const db = getDb();
    stmts = {
      insert: db.prepare(
        `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
         VALUES (?, ?, ?, ?)`
      ),
      findByHash: db.prepare(
        `SELECT * FROM refresh_tokens WHERE token_hash = ?`
      ),
      revoke: db.prepare(
        `UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?`
      ),
      revokeAll: db.prepare(
        `UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?`
      ),
      purgeStale: db.prepare(
        `DELETE FROM refresh_tokens WHERE revoked = 1 OR expires_at < ?`
      ),
    };
  }
  return stmts;
}

function create({ id, userId, tokenHash, expiresAt }) {
  getStmts().insert.run(id, userId, tokenHash, expiresAt);
}

function findByHash(tokenHash) {
  return getStmts().findByHash.get(tokenHash) ?? null;
}

function revoke(tokenHash) {
  getStmts().revoke.run(tokenHash);
}

function revokeAll(userId) {
  getStmts().revokeAll.run(userId);
}

function purgeStale() {
  getStmts().purgeStale.run(Date.now());
}

module.exports = { create, findByHash, revoke, revokeAll, purgeStale };
