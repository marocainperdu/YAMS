'use strict';

const path = require('path');
const Database = require('better-sqlite3');

// Database file — overridable via YAMS_DB env var (used by tests)
const DB_PATH = process.env.YAMS_DB || path.join(__dirname, '..', 'yams.db');

let _db = null;

/**
 * Returns the single shared database connection.
 * Opens + migrates on first call; subsequent calls return the cached instance.
 */
function getDb() {
  if (!_db) {
    _db = new Database(DB_PATH);

    // WAL mode gives better read concurrency and is safer on power loss
    _db.exec("PRAGMA journal_mode = WAL");
    _db.exec("PRAGMA foreign_keys = ON");

    migrate(_db);
  }
  return _db;
}

/**
 * Runs idempotent schema migrations.
 * Add future migrations here as additional exec() calls.
 */
function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS servers (
      id          TEXT    PRIMARY KEY,
      name        TEXT    NOT NULL UNIQUE,
      path        TEXT    NOT NULL,
      port        INTEGER NOT NULL UNIQUE,
      ram         TEXT    NOT NULL DEFAULT '1G',
      status      TEXT    NOT NULL DEFAULT 'stopped'
                          CHECK (status IN ('stopped', 'running')),
      pid         INTEGER,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id            TEXT    PRIMARY KEY,
      username      TEXT    NOT NULL UNIQUE,
      password_hash TEXT    NOT NULL,
      role          TEXT    NOT NULL CHECK (role IN ('admin', 'operator', 'user')),
      token_version INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );

  `);

  // Idempotent column addition for DBs created before token_version existed.
  try {
    db.exec(`ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0`);
  } catch (e) {
    if (!e.message.includes('duplicate column')) throw e;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id          TEXT    PRIMARY KEY,
      user_id     TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash  TEXT    NOT NULL UNIQUE,
      expires_at  INTEGER NOT NULL,
      revoked     INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS schedules (
      id          TEXT    PRIMARY KEY,
      server_id   TEXT    NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      name        TEXT    NOT NULL,
      cron        TEXT    NOT NULL,
      command     TEXT    NOT NULL,
      enabled     INTEGER NOT NULL DEFAULT 1,
      last_run_at TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

module.exports = { getDb };
