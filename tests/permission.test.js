'use strict';

/**
 * RBAC + per-server permission integration tests.
 *
 * Spawns the real app with YAMS_AUTH_ENABLED=true.
 * Tests run sequentially within the describe block — later tests depend on
 * state set up by earlier ones (permission assignments, etc.).
 *
 * Run: npm test
 */

const { test, describe, before, after } = require('node:test');
const assert  = require('node:assert/strict');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const { spawn } = require('child_process');

// ─── Isolated env ────────────────────────────────────────────────────────────

const HTTP_PORT      = 3097;
const HTTP_TEST_DB   = path.join(os.tmpdir(), `yams-perm-${Date.now()}.db`);
const HTTP_TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'yams-perm-'));
const HTTP_BASE      = `http://localhost:${HTTP_PORT}`;

const ADMIN_EMAIL    = 'admin@perm-test.com';
const ADMIN_PASSWORD = 'adminpass123';
const USER_EMAIL     = 'user@perm-test.com';
const USER_PASSWORD  = 'userpass123';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function api(method, endpoint, body, token) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res  = await fetch(`${HTTP_BASE}${endpoint}`, opts);
  const json = await res.json();
  return { status: res.status, body: json };
}

function waitForApp(proc, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('App did not start in time')), timeout);
    proc.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('Running on')) { clearTimeout(deadline); resolve(); }
    });
    proc.stderr.on('data', (chunk) => process.stderr.write(`[app-perm] ${chunk}`));
    proc.on('error', (err) => { clearTimeout(deadline); reject(err); });
    proc.on('exit', (code) => {
      if (code !== 0) { clearTimeout(deadline); reject(new Error(`App exited early (${code})`)); }
    });
  });
}

// ═════════════════════════════════════════════════════════════════════════════

describe('Permission system — HTTP integration', () => {
  let appProcess;
  let adminToken;
  let userToken;
  let testServerId;
  let testUserId;

  before(async () => {
    appProcess = spawn(
      process.execPath,
      ['--disable-warning=ExperimentalWarning', 'app.js'],
      {
        cwd: path.join(__dirname, '..'),
        env: {
          ...process.env,
          PORT:                String(HTTP_PORT),
          YAMS_DB:             HTTP_TEST_DB,
          YAMS_SERVERS_ROOT:   HTTP_TEST_ROOT,
          JWT_SECRET:          'perm-test-secret',
          YAMS_AUTH_ENABLED:   'true',
          YAMS_ADMIN_EMAIL:    ADMIN_EMAIL,
          YAMS_ADMIN_PASSWORD: ADMIN_PASSWORD,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    await waitForApp(appProcess);

    // ── Bootstrap: login as admin ────────────────────────────────────────────
    const loginRes = await api('POST', '/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    assert.equal(loginRes.status, 200, 'admin login must succeed in before()');
    adminToken = loginRes.body.data.token;

    // ── Bootstrap: create a server (POST /servers is unprotected) ────────────
    const srvRes = await api('POST', '/servers', { name: 'permtest', port: 25580, ram: '1G' });
    assert.equal(srvRes.status, 201, 'server creation must succeed in before()');
    testServerId = srvRes.body.data.id;

    // ── Bootstrap: create a regular user via admin ───────────────────────────
    const userRes = await api('POST', '/users', {
      email: USER_EMAIL, password: USER_PASSWORD, role: 'user',
    }, adminToken);
    assert.equal(userRes.status, 201, 'user creation must succeed in before()');
    testUserId = userRes.body.data.id;

    // ── Bootstrap: login as regular user ─────────────────────────────────────
    const userLoginRes = await api('POST', '/auth/login', { email: USER_EMAIL, password: USER_PASSWORD });
    assert.equal(userLoginRes.status, 200, 'user login must succeed in before()');
    userToken = userLoginRes.body.data.token;
  });

  after(() => {
    appProcess?.kill();
    try { fs.rmSync(HTTP_TEST_ROOT, { recursive: true, force: true }); } catch {}
    for (const s of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(HTTP_TEST_DB + s); } catch {}
    }
  });

  // ── Authentication gates ──────────────────────────────────────────────────

  test('GET /servers without token → 401', async () => {
    const { status } = await api('GET', '/servers');
    assert.equal(status, 401);
  });

  test('GET /servers with user token → 200 (list requires only auth)', async () => {
    const { status, body } = await api('GET', '/servers', undefined, userToken);
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.data), 'data is array');
  });

  // ── User cannot access server without permission ──────────────────────────

  test('user cannot GET /servers/:id without "view" permission → 403', async () => {
    const { status } = await api('GET', `/servers/${testServerId}`, undefined, userToken);
    assert.equal(status, 403);
  });

  test('user cannot POST /servers/:id/start without "start" permission → 403', async () => {
    const { status } = await api('POST', `/servers/${testServerId}/start`, undefined, userToken);
    assert.equal(status, 403);
  });

  test('user cannot POST /servers/:id/stop without "stop" permission → 403', async () => {
    const { status } = await api('POST', `/servers/${testServerId}/stop`, undefined, userToken);
    assert.equal(status, 403);
  });

  // ── Admin bypass works ────────────────────────────────────────────────────

  test('admin can GET /servers/:id without explicit permission → 200', async () => {
    const { status, body } = await api('GET', `/servers/${testServerId}`, undefined, adminToken);
    assert.equal(status, 200);
    assert.equal(body.data.id, testServerId);
  });

  test('admin POST /servers/:id/start bypasses permission check (fails 400 — no jar, not 403)', async () => {
    const { status } = await api('POST', `/servers/${testServerId}/start`, undefined, adminToken);
    assert.notEqual(status, 403, 'admin must not be rejected by permission middleware');
    assert.notEqual(status, 401);
  });

  // ── Assign permissions (admin-only endpoint) ──────────────────────────────

  test('regular user cannot POST /users → 403', async () => {
    const { status } = await api('POST', '/users', {
      email: 'another@example.com', password: 'pass123', role: 'user',
    }, userToken);
    assert.equal(status, 403);
  });

  test('regular user cannot GET /users → 403', async () => {
    const { status } = await api('GET', '/users', undefined, userToken);
    assert.equal(status, 403);
  });

  test('admin can GET /users → 200 with user list', async () => {
    const { status, body } = await api('GET', '/users', undefined, adminToken);
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.data));
    assert.ok(body.data.length >= 2, 'at least admin + test user');
  });

  test('admin assigns "view" permission to user → 200', async () => {
    const { status, body } = await api('POST', '/permissions', {
      userId: testUserId,
      serverId: testServerId,
      permissions: { view: true, start: false, stop: false },
    }, adminToken);
    assert.equal(status, 200);
    assert.ok(body.data?.permissions, 'permissions object returned');
    assert.equal(body.data.permissions.view, true);
  });

  // ── User can access with permission ──────────────────────────────────────

  test('user can GET /servers/:id after receiving "view" permission → 200', async () => {
    const { status, body } = await api('GET', `/servers/${testServerId}`, undefined, userToken);
    assert.equal(status, 200);
    assert.equal(body.data.id, testServerId);
  });

  // ── start/stop restrictions enforced ─────────────────────────────────────

  test('user with only "view" still cannot POST /servers/:id/start → 403', async () => {
    const { status } = await api('POST', `/servers/${testServerId}/start`, undefined, userToken);
    assert.equal(status, 403);
  });

  test('admin assigns "start" + "stop" permissions → 200', async () => {
    const { status, body } = await api('POST', '/permissions', {
      userId: testUserId,
      serverId: testServerId,
      permissions: { view: true, start: true, stop: true },
    }, adminToken);
    assert.equal(status, 200);
    assert.equal(body.data.permissions.start, true);
    assert.equal(body.data.permissions.stop,  true);
  });

  test('user with "start" permission passes auth check (400 no jar — not 403)', async () => {
    const { status } = await api('POST', `/servers/${testServerId}/start`, undefined, userToken);
    assert.notEqual(status, 403, 'permission check must pass');
    assert.notEqual(status, 401);
  });

  test('user with "stop" permission passes auth check (409 not running — not 403)', async () => {
    const { status } = await api('POST', `/servers/${testServerId}/stop`, undefined, userToken);
    assert.notEqual(status, 403, 'permission check must pass');
    assert.notEqual(status, 401);
  });

  // ── Metrics route also respects "view" permission ─────────────────────────

  test('user with "view" can GET /servers/:id/metrics → 200', async () => {
    const { status } = await api('GET', `/servers/${testServerId}/metrics`, undefined, userToken);
    assert.equal(status, 200);
  });

  test('GET /servers/:id/metrics without token → 401', async () => {
    const { status } = await api('GET', `/servers/${testServerId}/metrics`);
    assert.equal(status, 401);
  });
});
