'use strict';

/**
 * Tests for the server metrics module.
 *
 * Structure:
 *   1. Unit tests — pure parsing functions (no HTTP, no DB)
 *   2. HTTP integration tests — full endpoint via spawned app process
 *
 * Run: npm test
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');
const fs     = require('fs');
const fsp    = require('fs/promises');
const os     = require('os');
const { spawn } = require('child_process');

// ─── Env setup — MUST precede any module import that reads env at load time ──

const UNIT_TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'yams-metrics-unit-'));
const UNIT_TEST_DB   = path.join(os.tmpdir(), `yams-metrics-unit-${Date.now()}.db`);

process.env.YAMS_SERVERS_ROOT = UNIT_TEST_ROOT;
process.env.YAMS_DB           = UNIT_TEST_DB;

// ─── Load service under test ─────────────────────────────────────────────────
// This will throw MODULE_NOT_FOUND until metricsService.js is created (RED phase).

let metricsService;
try {
  metricsService = require('../src/services/metricsService');
} catch (_) {
  metricsService = null;
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

after(() => {
  try { fs.rmSync(UNIT_TEST_ROOT, { recursive: true, force: true }); } catch {}
  for (const s of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(UNIT_TEST_DB + s); } catch {}
  }
});

// ─── Helper ──────────────────────────────────────────────────────────────────

function svc(fnName) {
  if (!metricsService) {
    throw new Error('metricsService not loaded — create src/services/metricsService.js first');
  }
  if (typeof metricsService[fnName] !== 'function') {
    throw new Error(`metricsService.${fnName} is not exported or is not a function`);
  }
  return metricsService[fnName];
}

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 1 — Unit tests (pure parsing functions, no HTTP, no DB)
// ═════════════════════════════════════════════════════════════════════════════

describe('TPS parsing', () => {
  test('parses standard Paper/Spigot TPS line', () => {
    const r = svc('parseTps')('TPS from last 1m, 5m, 15m: 20.0, 20.0, 19.95');
    assert.deepEqual(r, { m1: 20.0, m5: 20.0, m15: 19.95 });
  });

  test('parses TPS embedded in full server log prefix', () => {
    const r = svc('parseTps')(
      '[18:00:00] [Server thread/INFO]: TPS from last 1m, 5m, 15m: 18.5, 19.0, 20.0'
    );
    assert.deepEqual(r, { m1: 18.5, m5: 19.0, m15: 20.0 });
  });

  test('parses non-round TPS values', () => {
    const r = svc('parseTps')('TPS from last 1m, 5m, 15m: 19.87, 20.0, 20.0');
    assert.deepEqual(r, { m1: 19.87, m5: 20.0, m15: 20.0 });
  });

  test('returns null for unrelated log lines', () => {
    const parseTps = svc('parseTps');
    assert.equal(parseTps('Server started on port 25565'), null);
    assert.equal(parseTps('Done (5.1s)! For help, type "help"'), null);
    assert.equal(parseTps(''), null);
  });

  test('returns null for partial TPS pattern', () => {
    const parseTps = svc('parseTps');
    assert.equal(parseTps('TPS from last 1m: 20'), null);
    assert.equal(parseTps('TPS 20.0 20.0 20.0'), null);
  });
});

describe('Player join events', () => {
  test('parses player join', () => {
    assert.equal(svc('parsePlayerJoin')('Steve joined the game'), 'Steve');
  });

  test('parses join with underscored name', () => {
    assert.equal(svc('parsePlayerJoin')('Player_123 joined the game'), 'Player_123');
  });

  test('returns null for non-join lines', () => {
    const fn = svc('parsePlayerJoin');
    assert.equal(fn('random log line'), null);
    assert.equal(fn('left the game'), null);
    assert.equal(fn(''), null);
  });
});

describe('Player leave events', () => {
  test('parses player leave', () => {
    assert.equal(svc('parsePlayerLeave')('Alex left the game'), 'Alex');
  });

  test('parses leave with numeric suffix in name', () => {
    assert.equal(svc('parsePlayerLeave')('Player_456 left the game'), 'Player_456');
  });

  test('returns null for non-leave lines', () => {
    const fn = svc('parsePlayerLeave');
    assert.equal(fn('random log line'), null);
    assert.equal(fn('joined the game'), null);
    assert.equal(fn(''), null);
  });
});

describe('"list" command response parsing', () => {
  test('parses list with players online', () => {
    const r = svc('parseListResponse')(
      'There are 2 of a max of 20 players online: Steve, Alex'
    );
    assert.deepEqual(r, { online: 2, max: 20 });
  });

  test('parses list with zero players', () => {
    const r = svc('parseListResponse')('There are 0 of a max of 20 players online: ');
    assert.deepEqual(r, { online: 0, max: 20 });
  });

  test('parses list with non-default max', () => {
    const r = svc('parseListResponse')(
      'There are 5 of a max of 100 players online: a, b, c, d, e'
    );
    assert.deepEqual(r, { online: 5, max: 100 });
  });

  test('returns null for unrelated lines', () => {
    const fn = svc('parseListResponse');
    assert.equal(fn('Server started'), null);
    assert.equal(fn(''), null);
    assert.equal(fn('There are players'), null);
  });
});

describe('RAM / thread parsing from /proc status content', () => {
  test('parses VmRSS and converts kB → bytes', () => {
    const content = 'Name:\tjava\nVmRSS:\t524288 kB\nThreads:\t42\n';
    const r = svc('parseProcStatus')(content);
    assert.equal(r.vmRss, 524288 * 1024);
    assert.equal(r.threads, 42);
  });

  test('handles missing VmRSS', () => {
    const r = svc('parseProcStatus')('Name:\tjava\nThreads:\t10\n');
    assert.equal(r.vmRss, null);
    assert.equal(r.threads, 10);
  });

  test('handles missing Threads', () => {
    const r = svc('parseProcStatus')('VmRSS:\t1024 kB\n');
    assert.equal(r.vmRss, 1024 * 1024);
    assert.equal(r.threads, null);
  });

  test('returns nulls for empty content', () => {
    const r = svc('parseProcStatus')('');
    assert.equal(r.vmRss, null);
    assert.equal(r.threads, null);
  });

  test('parses small RAM value correctly', () => {
    const r = svc('parseProcStatus')('VmRSS:\t1 kB\nThreads:\t1\n');
    assert.equal(r.vmRss, 1024);
    assert.equal(r.threads, 1);
  });
});

describe('Directory size computation', () => {
  let tmpDir;

  before(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'yams-dirsize-'));
    await fsp.writeFile(path.join(tmpDir, 'file1.txt'), 'a'.repeat(100));
    await fsp.mkdir(path.join(tmpDir, 'sub'));
    await fsp.writeFile(path.join(tmpDir, 'sub', 'file2.txt'), 'b'.repeat(200));
  });

  after(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  test('sums all files recursively', async () => {
    const size = await svc('dirSize')(tmpDir);
    // file1 (100) + sub/file2 (200) = at least 300
    assert.ok(size >= 300, `expected size >= 300, got ${size}`);
  });

  test('returns 0 for non-existent directory', async () => {
    const size = await svc('dirSize')('/nonexistent/path/yams-test-missing');
    assert.equal(size, 0);
  });

  test('returns 0 for empty directory', async () => {
    const emptyDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'yams-empty-'));
    try {
      const size = await svc('dirSize')(emptyDir);
      assert.equal(size, 0);
    } finally {
      await fsp.rm(emptyDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 2 — HTTP integration tests (full endpoint via spawned app process)
// ═════════════════════════════════════════════════════════════════════════════

const HTTP_PORT      = 3098;
const HTTP_TEST_DB   = path.join(os.tmpdir(), `yams-metrics-http-${Date.now()}.db`);
const HTTP_TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'yams-metrics-http-'));
const HTTP_BASE      = `http://localhost:${HTTP_PORT}`;

describe('GET /servers/:id/metrics — HTTP endpoint', () => {
  let appProcess;
  let testServerId;

  async function api(method, endpoint, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(`${HTTP_BASE}${endpoint}`, opts);
    const json = await res.json();
    return { status: res.status, body: json };
  }

  function waitForApp(proc, timeout = 8000) {
    return new Promise((resolve, reject) => {
      const deadline = setTimeout(
        () => reject(new Error('App did not start in time')),
        timeout
      );
      proc.stdout.on('data', (chunk) => {
        if (chunk.toString().includes('Running on')) {
          clearTimeout(deadline);
          resolve();
        }
      });
      proc.stderr.on('data', (chunk) => {
        process.stderr.write(`[app-metrics] ${chunk}`);
      });
      proc.on('error', (err) => { clearTimeout(deadline); reject(err); });
      proc.on('exit', (code) => {
        if (code !== 0) {
          clearTimeout(deadline);
          reject(new Error(`App exited early with code ${code}`));
        }
      });
    });
  }

  before(async () => {
    appProcess = spawn(
      process.execPath,
      ['--disable-warning=ExperimentalWarning', 'app.js'],
      {
        cwd: path.join(__dirname, '..'),
        env: {
          ...process.env,
          PORT: String(HTTP_PORT),
          YAMS_DB: HTTP_TEST_DB,
          YAMS_SERVERS_ROOT: HTTP_TEST_ROOT,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    await waitForApp(appProcess);

    // Create a stopped server (no server.jar — server stays stopped)
    const { body } = await api('POST', '/servers', {
      name: 'metrics-test',
      port: 25590,
      ram:  '1G',
    });
    testServerId = body.data?.id;
  });

  after(() => {
    appProcess?.kill();
    try { fs.rmSync(HTTP_TEST_ROOT, { recursive: true, force: true }); } catch {}
    for (const s of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(HTTP_TEST_DB + s); } catch {}
    }
  });

  test('404 for unknown server ID', async () => {
    const { status, body } = await api(
      'GET',
      '/servers/00000000-0000-0000-0000-000000000000/metrics'
    );
    assert.equal(status, 404);
    assert.ok(body.error, 'response has error field');
  });

  test('200 with correct top-level structure for stopped server', async () => {
    assert.ok(testServerId, 'server was created in before()');
    const { status, body } = await api('GET', `/servers/${testServerId}/metrics`);
    assert.equal(status, 200);
    const d = body.data;
    assert.ok(d, 'body.data exists');
    // server section
    assert.equal(d.server.id, testServerId);
    assert.equal(d.server.status, 'stopped');
    assert.equal(typeof d.server.name, 'string');
    assert.equal(typeof d.server.port, 'number');
    assert.equal(typeof d.server.uptime, 'number');
    // process is null when stopped
    assert.equal(d.process, null, 'process is null for stopped server');
    // minecraft section
    assert.ok(d.minecraft, 'has minecraft section');
    assert.ok(d.minecraft.tps, 'has tps sub-object');
    assert.ok(d.minecraft.players, 'has players sub-object');
    assert.equal(typeof d.minecraft.world, 'string', 'world is a string');
    // disk section
    assert.ok(d.disk, 'has disk section');
    // sampledAt
    assert.equal(typeof d.sampledAt, 'number', 'sampledAt is a number');
  });

  test('disk values are non-negative numbers', async () => {
    assert.ok(testServerId, 'server was created in before()');
    const { body } = await api('GET', `/servers/${testServerId}/metrics`);
    const disk = body.data?.disk;
    assert.ok(disk, 'has disk section');
    assert.ok(typeof disk.root === 'number' && disk.root >= 0, `disk.root >= 0 (got ${disk.root})`);
    assert.ok(typeof disk.backups === 'number' && disk.backups >= 0, `disk.backups >= 0 (got ${disk.backups})`);
    assert.equal(typeof disk.worlds, 'object', 'disk.worlds is an object');
  });

  test('player count is never negative', async () => {
    const { body } = await api('GET', `/servers/${testServerId}/metrics`);
    const players = body.data?.minecraft?.players;
    assert.ok(players, 'has players');
    assert.ok(players.online >= 0, `online >= 0 (got ${players.online})`);
    assert.ok(players.max > 0, `max > 0 (got ${players.max})`);
  });

  test('TPS fields have correct types', async () => {
    const { body } = await api('GET', `/servers/${testServerId}/metrics`);
    const tps = body.data?.minecraft?.tps;
    assert.ok(tps, 'has tps');
    assert.equal(typeof tps.available, 'boolean', 'available is boolean');
    // m1/m5/m15 are null (server stopped, no TPS data) or numbers
    for (const field of ['m1', 'm5', 'm15']) {
      assert.ok(
        tps[field] === null || typeof tps[field] === 'number',
        `tps.${field} is null or number`
      );
    }
  });
});
