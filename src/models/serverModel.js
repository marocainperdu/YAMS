'use strict';

/**
 * SQL layer for the `servers` table.
 * All queries use prepared statements (StatementSync from node:sqlite).
 * Functions return plain JS objects — no ORM wrappers.
 *
 * Uses positional `?` parameters throughout for simplicity and compatibility
 * with the node:sqlite StatementSync API.
 */

const { getDb } = require('../db');

// Prepared statement cache — initialized lazily on first use
let stmts = null;

function getStmts() {
  if (!stmts) {
    const db = getDb();
    stmts = {
      insert: db.prepare(
        `INSERT INTO servers (id, name, path, port, ram)
         VALUES (?, ?, ?, ?, ?)`
      ),
      findAll: db.prepare(
        `SELECT * FROM servers ORDER BY created_at DESC`
      ),
      findById: db.prepare(
        `SELECT * FROM servers WHERE id = ?`
      ),
      findByPort: db.prepare(
        `SELECT * FROM servers WHERE port = ?`
      ),
      findByName: db.prepare(
        `SELECT * FROM servers WHERE name = ?`
      ),
      updateStatus: db.prepare(
        `UPDATE servers
         SET status = ?, pid = ?, updated_at = datetime('now')
         WHERE id = ?`
      ),
      remove: db.prepare(
        `DELETE FROM servers WHERE id = ?`
      ),
    };
  }
  return stmts;
}

/**
 * Insert a new server record.
 * @param {{ id: string, name: string, path: string, port: number, ram: string }} server
 * @returns {object} The created server row
 */
function create(server) {
  const s = getStmts();
  s.insert.run(server.id, server.name, server.path, server.port, server.ram);
  return findById(server.id);
}

/** @returns {object[]} All server rows, newest first */
function findAll() {
  return getStmts().findAll.all();
}

/**
 * @param {string} id
 * @returns {object|undefined}
 */
function findById(id) {
  return getStmts().findById.get(id);
}

/**
 * @param {number} port
 * @returns {object|undefined}
 */
function findByPort(port) {
  return getStmts().findByPort.get(port);
}

/**
 * @param {string} name
 * @returns {object|undefined}
 */
function findByName(name) {
  return getStmts().findByName.get(name);
}

/**
 * Update server status and PID.
 * @param {string} id
 * @param {'stopped'|'running'} status
 * @param {number|null} pid  — pass null when stopping
 */
function updateStatus(id, status, pid) {
  getStmts().updateStatus.run(status, pid ?? null, id);
}

/**
 * Delete a server record by ID.
 * Not exposed as an API endpoint in Step 1; available for future use.
 * @param {string} id
 */
function remove(id) {
  getStmts().remove.run(id);
}

module.exports = { create, findAll, findById, findByPort, findByName, updateStatus, remove };
