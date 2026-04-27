'use strict';

const { describe, test, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const fsp = require('fs/promises');

// ─── We require the service AFTER writing it in Task 2.
// For now, keep this file incomplete (it will fail to require).
// DO NOT run until Task 2 is done.

const svc = require('../src/services/metricsService');

// ─────────────────────────────────────────────────────────────────────────────
// Unit: _parseTps
// ─────────────────────────────────────────────────────────────────────────────
describe('_parseTps', () => {
  test('parses standard Paper format', () => {
    const result = svc._parseTps('[13:45:22 INFO]: TPS from last 1m, 5m, 15m: 20.0, 20.0, 19.95');
    assert.deepEqual(result, { tps1m: 20.0, tps5m: 20.0, tps15m: 19.95 });
  });

  test('parses asterisk format (capped TPS)', () => {
    const result = svc._parseTps('[13:45:22 INFO]: TPS from last 1m, 5m, 15m: *20.0, *20.0, *19.95');
    assert.deepEqual(result, { tps1m: 20.0, tps5m: 20.0, tps15m: 19.95 });
  });

  test('returns null for non-TPS line', () => {
    assert.equal(svc._parseTps('[13:45:22 INFO]: Unknown command'), null);
  });

  test('returns null for empty string', () => {
    assert.equal(svc._parseTps(''), null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit: _parsePlayerEvent
// ─────────────────────────────────────────────────────────────────────────────
describe('_parsePlayerEvent', () => {
  test('detects logged-in join', () => {
    assert.equal(
      svc._parsePlayerEvent('[13:45:22 INFO]: Steve[/1.2.3.4:1234] logged in with entity id 123 at ([world]1.0, 64.0, 1.0)'),
      'join'
    );
  });

  test('detects joined-the-game join', () => {
    assert.equal(
      svc._parsePlayerEvent('[13:45:22 INFO]: Steve joined the game'),
      'join'
    );
  });

  test('detects left-the-game leave', () => {
    assert.equal(
      svc._parsePlayerEvent('[13:45:22 INFO]: Steve left the game'),
      'leave'
    );
  });

  test('detects lost-connection leave', () => {
    assert.equal(
      svc._parsePlayerEvent('[13:45:22 INFO]: Steve lost connection: Disconnected'),
      'leave'
    );
  });

  test('returns null for unrelated line', () => {
    assert.equal(
      svc._parsePlayerEvent('[13:45:22 INFO]: Preparing spawn area: 83%'),
      null
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit: _parseListResponse
// ─────────────────────────────────────────────────────────────────────────────
describe('_parseListResponse', () => {
  test('parses list response with players', () => {
    const result = svc._parseListResponse(
      '[13:45:22 INFO]: There are 2 of a max of 20 players online: Alice, Bob'
    );
    assert.deepEqual(result, { online: 2, max: 20 });
  });

  test('parses list response with zero players', () => {
    const result = svc._parseListResponse(
      '[13:45:22 INFO]: There are 0 of a max of 20 players online: '
    );
    assert.deepEqual(result, { online: 0, max: 20 });
  });

  test('returns null for non-list line', () => {
    assert.equal(svc._parseListResponse('[13:45:22 INFO]: Steve joined the game'), null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit: _parseRamToMb
// ─────────────────────────────────────────────────────────────────────────────
describe('_parseRamToMb', () => {
  test('converts 1G to 1024', () => assert.equal(svc._parseRamToMb('1G'), 1024));
  test('converts 2G to 2048', () => assert.equal(svc._parseRamToMb('2G'), 2048));
  test('converts 512M to 512', () => assert.equal(svc._parseRamToMb('512M'), 512));
  test('is case-insensitive', () => assert.equal(svc._parseRamToMb('1g'), 1024));
  test('returns null for invalid input', () => assert.equal(svc._parseRamToMb('bad'), null));
  test('returns null for null', () => assert.equal(svc._parseRamToMb(null), null));
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit: _calcDirSize
// ─────────────────────────────────────────────────────────────────────────────
describe('_calcDirSize', () => {
  let tmpDir;

  before(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'yams-metrics-test-'));
    // Create: file1 (100 bytes), subdir/file2 (200 bytes)
    await fsp.writeFile(path.join(tmpDir, 'file1.txt'), 'x'.repeat(100));
    await fsp.mkdir(path.join(tmpDir, 'subdir'));
    await fsp.writeFile(path.join(tmpDir, 'subdir', 'file2.txt'), 'x'.repeat(200));
  });

  test('returns sum of all file sizes recursively', async () => {
    const size = await svc._calcDirSize(tmpDir);
    assert.ok(size >= 300, `expected >= 300 bytes, got ${size}`);
  });

  test('returns 0 for missing directory', async () => {
    const size = await svc._calcDirSize('/nonexistent/path/xyz');
    assert.equal(size, 0);
  });

  test('returns 0 for empty directory', async () => {
    const emptyDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'yams-empty-'));
    const size = await svc._calcDirSize(emptyDir);
    assert.equal(size, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit: _readMaxPlayers
// ─────────────────────────────────────────────────────────────────────────────
describe('_readMaxPlayers', () => {
  let tmpDir;

  before(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'yams-props-test-'));
  });

  test('returns 20 when server.properties absent', async () => {
    const max = await svc._readMaxPlayers(path.join(tmpDir, 'noexist'));
    assert.equal(max, 20);
  });

  test('returns 20 when key missing from file', async () => {
    const dir = await fsp.mkdtemp(path.join(tmpDir, 'no-key-'));
    await fsp.writeFile(path.join(dir, 'server.properties'), 'server-port=25565\n');
    const max = await svc._readMaxPlayers(dir);
    assert.equal(max, 20);
  });

  test('returns configured value', async () => {
    const dir = await fsp.mkdtemp(path.join(tmpDir, 'with-key-'));
    await fsp.writeFile(path.join(dir, 'server.properties'), 'server-port=25565\nmax-players=50\n');
    const max = await svc._readMaxPlayers(dir);
    assert.equal(max, 50);
  });

  test('handles Windows CRLF line endings', async () => {
    const dir = await fsp.mkdtemp(path.join(tmpDir, 'crlf-'));
    await fsp.writeFile(path.join(dir, 'server.properties'), 'server-port=25565\r\nmax-players=30\r\n');
    const max = await svc._readMaxPlayers(dir);
    assert.equal(max, 30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit: _readProcStat and _readProcStatus (non-Linux fallback)
// ─────────────────────────────────────────────────────────────────────────────
describe('_readProcStat', () => {
  test('returns null for a non-existent PID', () => {
    // PID 99999999 should not exist
    const result = svc._readProcStat(99999999);
    assert.equal(result, null);
  });

  test('returns object with utime/stime for real PID on Linux', function() {
    if (process.platform !== 'linux') return this.skip();
    const result = svc._readProcStat(process.pid);
    assert.ok(result !== null);
    assert.ok(typeof result.utime === 'number');
    assert.ok(typeof result.stime === 'number');
  });
});

describe('_readProcStatus', () => {
  test('returns null for a non-existent PID', () => {
    const result = svc._readProcStatus(99999999);
    assert.equal(result, null);
  });

  test('returns rssKb and threads for real PID on Linux', function() {
    if (process.platform !== 'linux') return this.skip();
    const result = svc._readProcStatus(process.pid);
    assert.ok(result !== null);
    assert.ok(typeof result.rssKb === 'number' && result.rssKb > 0);
    assert.ok(typeof result.threads === 'number' && result.threads > 0);
  });
});

describe('_readSysCpuTotal', () => {
  test('returns null on non-Linux', function() {
    if (process.platform === 'linux') return this.skip();
    assert.equal(svc._readSysCpuTotal(), null);
  });

  test('returns a positive number on Linux', function() {
    if (process.platform !== 'linux') return this.skip();
    const total = svc._readSysCpuTotal();
    assert.ok(typeof total === 'number' && total > 0);
  });
});
