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

module.exports = { create, findById, findByUsername, count };
