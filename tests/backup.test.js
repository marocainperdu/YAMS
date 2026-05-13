'use strict';

/**
 * Integration tests — backupService
 *
 * Runs against a real temp filesystem and an isolated SQLite DB.
 * No HTTP server required.
 *
 * Run: node --test tests/backup.test.js
 */

const { describe, test, before, after } = require('node:test');
const assert  = require('node:assert/strict');
const path    = require('path');
const fs      = require('fs');
const fsp     = require('fs/promises');
const os      = require('os');
const { v4: uuidv4 } = require('uuid');
const { Writable } = require('stream');
const unzipper = require('unzipper');

// ─── Env setup — MUST precede any module that reads env at load time ──────────

const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'yams-backup-'));
const TEST_DB   = path.join(os.tmpdir(), `yams-backup-${Date.now()}.db`);

process.env.YAMS_SERVERS_ROOT = TEST_ROOT;
process.env.YAMS_DB           = TEST_DB;

const backupService = require('../src/services/backupService');
const serverModel   = require('../src/models/serverModel');

// ─── Cleanup ──────────────────────────────────────────────────────────────────

after(() => {
  try { fs.rmSync(TEST_ROOT, { recursive: true, force: true }); } catch {}
  for (const s of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB + s); } catch {}
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _portSeq = 30000;

async function makeServer(opts = {}) {
  const serverId  = uuidv4();
  const serverDir = path.join(TEST_ROOT, serverId);
  await fsp.mkdir(serverDir, { recursive: true });
  serverModel.create({
    id:   serverId,
    name: opts.name || `srv-${serverId.slice(0, 8)}`,
    path: serverDir,
    port: ++_portSeq,
    ram:  '1G',
  });
  return { serverId, serverDir };
}

async function populateServer(serverDir) {
  await fsp.writeFile(path.join(serverDir, 'server.properties'), 'level-name=world\n');
  await fsp.writeFile(path.join(serverDir, 'server.jar'),        'fake-jar');
  await fsp.mkdir(path.join(serverDir, 'world'), { recursive: true });
  await fsp.writeFile(path.join(serverDir, 'world', 'level.dat'), 'nbt');
  await fsp.writeFile(path.join(serverDir, 'session.lock'), 'lock');
  await fsp.mkdir(path.join(serverDir, 'logs'), { recursive: true });
  await fsp.writeFile(path.join(serverDir, 'logs', 'latest.log'), 'log data');
}

class FakeRes extends Writable {
  constructor() {
    super();
    this.headers = {};
    this._chunks = [];
  }
  setHeader(k, v) { this.headers[k] = v; }
  _write(chunk, _enc, cb) { this._chunks.push(chunk); cb(); }
  getBuffer() { return Buffer.concat(this._chunks); }
}

// ─────────────────────────────────────────────────────────────────────────────
// listBackups
// ─────────────────────────────────────────────────────────────────────────────

describe('listBackups', () => {
  test('returns empty array when no backups exist', async () => {
    const { serverDir } = await makeServer();
    const result = await backupService.listBackups(serverDir);
    assert.deepEqual(result, []);
  });

  test('returns backup objects with required fields', async () => {
    const { serverId, serverDir } = await makeServer();
    await populateServer(serverDir);
    const backup = await backupService.createBackup(serverId, serverDir);

    const list = await backupService.listBackups(serverDir);
    assert.equal(list.length, 1);
    const b = list[0];
    assert.equal(b.id, backup.id);
    assert.equal(typeof b.name, 'string');
    assert.ok(b.name.startsWith('backup-'));
    assert.ok(b.name.endsWith('.zip'));
    assert.ok(typeof b.size === 'number' && b.size > 0);
    assert.ok(typeof b.createdAt === 'number');
  });

  test('returns backups sorted newest-first', async () => {
    const { serverId, serverDir } = await makeServer();
    await populateServer(serverDir);

    const b1 = await backupService.createBackup(serverId, serverDir);
    await new Promise(r => setTimeout(r, 10));
    const b2 = await backupService.createBackup(serverId, serverDir);

    const list = await backupService.listBackups(serverDir);
    assert.equal(list.length, 2);
    assert.equal(list[0].id, b2.id, 'newest backup must come first');
  });

  test('ignores .tmp.zip files left from interrupted backups', async () => {
    const { serverDir } = await makeServer();
    const backupsDir = path.join(serverDir, 'backups');
    await fsp.mkdir(backupsDir, { recursive: true });
    await fsp.writeFile(path.join(backupsDir, `${uuidv4()}.tmp.zip`), 'partial');

    const list = await backupService.listBackups(serverDir);
    assert.equal(list.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createBackup
// ─────────────────────────────────────────────────────────────────────────────

describe('createBackup', () => {
  test('returns backup metadata with id, name, size, createdAt', async () => {
    const { serverId, serverDir } = await makeServer();
    await populateServer(serverDir);
    const backup = await backupService.createBackup(serverId, serverDir);

    assert.ok(backup.id);
    assert.ok(backup.name.startsWith('backup-'));
    assert.ok(backup.size > 0);
    assert.ok(typeof backup.createdAt === 'number');
  });

  test('produces a valid ZIP file', async () => {
    const { serverId, serverDir } = await makeServer();
    await populateServer(serverDir);
    const backup = await backupService.createBackup(serverId, serverDir);

    const backupPath = path.join(serverDir, 'backups', `${backup.id}.zip`);
    const zipDir = await unzipper.Open.file(backupPath);
    assert.ok(zipDir.files.length > 0);
  });

  test('excludes logs, crash-reports, and backups directories', async () => {
    const { serverId, serverDir } = await makeServer();
    await populateServer(serverDir);
    await fsp.mkdir(path.join(serverDir, 'crash-reports'), { recursive: true });
    await fsp.writeFile(path.join(serverDir, 'crash-reports', 'crash.txt'), 'crash');

    const backup = await backupService.createBackup(serverId, serverDir);
    const zipDir = await unzipper.Open.file(
      path.join(serverDir, 'backups', `${backup.id}.zip`)
    );
    const names = zipDir.files.map(f => f.path);

    assert.ok(!names.some(n => n.startsWith('logs/')),          'logs/ must be excluded');
    assert.ok(!names.some(n => n.startsWith('crash-reports/')), 'crash-reports/ must be excluded');
    assert.ok(!names.some(n => n.startsWith('backups/')),       'backups/ must be excluded');
  });

  test('excludes .lock files', async () => {
    const { serverId, serverDir } = await makeServer();
    await populateServer(serverDir);

    const backup = await backupService.createBackup(serverId, serverDir);
    const zipDir = await unzipper.Open.file(
      path.join(serverDir, 'backups', `${backup.id}.zip`)
    );
    const names = zipDir.files.map(f => f.path);
    assert.ok(!names.some(n => n.endsWith('.lock')), '.lock files must be excluded');
  });

  test('includes server.properties and world directory', async () => {
    const { serverId, serverDir } = await makeServer();
    await populateServer(serverDir);

    const backup = await backupService.createBackup(serverId, serverDir);
    const zipDir = await unzipper.Open.file(
      path.join(serverDir, 'backups', `${backup.id}.zip`)
    );
    const names = zipDir.files.map(f => f.path);
    assert.ok(names.includes('server.properties'));
    assert.ok(names.some(n => n.startsWith('world/')));
  });

  test('409 SERVER_RUNNING when server is running', async () => {
    const { serverId, serverDir } = await makeServer();
    serverModel.updateStatus(serverId, 'running', 99999);
    try {
      await assert.rejects(
        () => backupService.createBackup(serverId, serverDir),
        e => e.statusCode === 409 && e.code === 'SERVER_RUNNING'
      );
    } finally {
      serverModel.updateStatus(serverId, 'stopped', null);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deleteBackup
// ─────────────────────────────────────────────────────────────────────────────

describe('deleteBackup', () => {
  test('removes the backup file', async () => {
    const { serverId, serverDir } = await makeServer();
    await populateServer(serverDir);
    const backup = await backupService.createBackup(serverId, serverDir);

    await backupService.deleteBackup(serverDir, backup.id);

    const backupPath = path.join(serverDir, 'backups', `${backup.id}.zip`);
    await assert.rejects(
      () => fsp.access(backupPath),
      { code: 'ENOENT' }
    );
  });

  test('404 for unknown backup ID', async () => {
    const { serverDir } = await makeServer();
    await assert.rejects(
      () => backupService.deleteBackup(serverDir, uuidv4()),
      e => e.statusCode === 404
    );
  });

  test('400 for invalid backup ID format', async () => {
    const { serverDir } = await makeServer();
    await assert.rejects(
      () => backupService.deleteBackup(serverDir, 'not-a-uuid'),
      e => e.statusCode === 400
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// streamBackup
// ─────────────────────────────────────────────────────────────────────────────

describe('streamBackup', () => {
  test('streams zip content with correct headers', async () => {
    const { serverId, serverDir } = await makeServer();
    await populateServer(serverDir);
    const backup = await backupService.createBackup(serverId, serverDir);

    const res = new FakeRes();
    await backupService.streamBackup(serverDir, backup.id, res);

    assert.equal(res.headers['Content-Type'], 'application/zip');
    assert.ok(res.headers['Content-Disposition'].includes('.zip'));
    assert.ok(res.headers['Content-Disposition'].includes('attachment'));
    assert.ok(res.getBuffer().length > 0, 'response body must not be empty');
  });

  test('streamed content is a valid ZIP', async () => {
    const { serverId, serverDir } = await makeServer();
    await populateServer(serverDir);
    const backup = await backupService.createBackup(serverId, serverDir);

    const res = new FakeRes();
    await backupService.streamBackup(serverDir, backup.id, res);

    const zipDir = await unzipper.Open.buffer(res.getBuffer());
    assert.ok(zipDir.files.length > 0);
  });

  test('404 for unknown backup ID', async () => {
    const { serverDir } = await makeServer();
    await assert.rejects(
      () => backupService.streamBackup(serverDir, uuidv4(), new FakeRes()),
      e => e.statusCode === 404
    );
  });
});
