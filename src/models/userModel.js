'use strict';

const { getDb } = require('../db');

let stmts = null;

function getStmts() {
  if (!stmts) {
    const db = getDb();
    stmts = {
      insert: db.prepare(
        `INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)`
      ),
      findById: db.prepare(
        `SELECT * FROM users WHERE id = ?`
      ),
      findByUsername: db.prepare(
        `SELECT * FROM users WHERE username = ?`
      ),
      count: db.prepare(
        `SELECT COUNT(*) AS n FROM users`
      ),
      findAll: db.prepare(
        `SELECT id, username, role, created_at FROM users ORDER BY created_at ASC`
      ),
      updateRole: db.prepare(
        `UPDATE users SET role = ? WHERE id = ?`
      ),
      remove: db.prepare(
        `DELETE FROM users WHERE id = ?`
      ),
      incrementTokenVersion: db.prepare(
        `UPDATE users SET token_version = token_version + 1 WHERE id = ?`
      ),
      updateUsername: db.prepare(
        `UPDATE users SET username = ? WHERE id = ?`
      ),
      updateEmail: db.prepare(
        `UPDATE users SET email = ? WHERE id = ?`
      ),
      updatePassword: db.prepare(
        `UPDATE users SET password_hash = ? WHERE id = ?`
      ),
      updateTotp: db.prepare(
        `UPDATE users SET totp_secret = ?, totp_enabled = ? WHERE id = ?`
      ),
      updateTotpLastCode: db.prepare(
        `UPDATE users SET totp_last_code = ? WHERE id = ?`
      ),
    };
  }
  return stmts;
}

function create({ id, username, passwordHash, role }) {
  getStmts().insert.run(id, username, passwordHash, role);
  return findById(id);
}

function findById(id) {
  return getStmts().findById.get(id) ?? null;
}

function findByUsername(username) {
  return getStmts().findByUsername.get(username) ?? null;
}

function count() {
  return getStmts().count.get().n;
}

function findAll() {
  return getStmts().findAll.all();
}

function updateRole(id, role) {
  getStmts().updateRole.run(role, id);
  return findById(id);
}

function remove(id) {
  getStmts().remove.run(id);
}

function incrementTokenVersion(id) {
  getStmts().incrementTokenVersion.run(id);
}

function updateUsername(id, username) {
  getStmts().updateUsername.run(username, id);
}

function updateEmail(id, email) {
  getStmts().updateEmail.run(email ?? null, id);
}

function updatePassword(id, passwordHash) {
  getStmts().updatePassword.run(passwordHash, id);
}

function updateTotp(id, { secret, enabled }) {
  getStmts().updateTotp.run(secret ?? null, enabled ? 1 : 0, id);
}

function updateTotpLastCode(id, codeHash) {
  getStmts().updateTotpLastCode.run(codeHash, id);
}

module.exports = {
  create, findById, findByUsername, count, findAll,
  updateRole, remove, incrementTokenVersion,
  updateUsername, updateEmail, updatePassword, updateTotp, updateTotpLastCode,
};
