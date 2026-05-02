'use strict';

const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');

let stmts = null;

function getStmts() {
  if (!stmts) {
    const db = getDb();
    stmts = {
      insert: db.prepare(
        `INSERT INTO users (id, email, password_hash, role, created_at, must_change_password)
         VALUES (?, ?, ?, ?, ?, ?)`
      ),
      findAll: db.prepare(
        `SELECT id, email, role, created_at FROM users ORDER BY created_at DESC`
      ),
      findByEmail: db.prepare(`SELECT * FROM users WHERE email = ?`),
      findById:    db.prepare(`SELECT * FROM users WHERE id = ?`),
      count:       db.prepare(`SELECT COUNT(*) AS c FROM users`),
      updatePassword: db.prepare(
        `UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?`
      ),
    };
  }
  return stmts;
}

function create({ email, passwordHash, role = 'user', mustChangePassword = false }) {
  const s = getStmts();
  const id = uuidv4();
  s.insert.run(id, email, passwordHash, role, Date.now(), mustChangePassword ? 1 : 0);
  return findById(id);
}

function updatePassword(id, newHash) {
  getStmts().updatePassword.run(newHash, id);
}

function findAll() {
  return getStmts().findAll.all();
}

function findByEmail(email) {
  return getStmts().findByEmail.get(email);
}

function findById(id) {
  return getStmts().findById.get(id);
}

function count() {
  return getStmts().count.get().c;
}

module.exports = { create, findAll, findByEmail, findById, count, updatePassword };
