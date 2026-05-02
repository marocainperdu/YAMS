'use strict';

/**
 * RBAC + per-server permission integration tests.
 *
 * Permission model: { read, control }
 *   read    — GET /servers/:id, GET /servers/:id/metrics
 *   control — POST /servers/:id/start, POST /servers/:id/stop
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

    // Login as admin
    const loginRes = await api('POST', '/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    assert.equal(loginRes.status, 200, 'admin login must succeed in before()');
    adminToken = loginRes.body.data.token;

    // Create a test server (POST /servers is unprotected)
    const srvRes = await api('POST', '/servers', { name: 'permtest', port: 25580, ram: '1G' });
    assert.equal(srvRes.status, 201, 'server creation must succeed in before()');
    testServerId = srvRes.body.data.id;

    // Create a regular user (as admin)
    const userRes = await api('POST', '/users', {
      email: USER_EMAIL, password: USER_PASSWORD, role: 'user',
    }, adminToken);
    assert.equal(userRes.status, 201, 'user creation must succeed in before()');
    testUserId = userRes.body.data.id;

    // Login as regular user
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

  // ── Auth disabled = public (verified by existing test.js, which never sends tokens) ──

  // ── Authentication gates ──────────────────────────────────────────────────

  test('GET /servers without token → 401', async () => {
    const { status } = await api('GET', '/servers');
    assert.equal(status, 401);
  });

  test('GET /servers with user token → 200', async () => {
    const { status, body } = await api('GET', '/servers', undefined, userToken);
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.data));
  });

  // ── Permission denied (403) ───────────────────────────────────────────────

  test('user cannot GET /servers/:id without "read" permission → 403', async () => {
    const { status } = await api('GET', `/servers/${testServerId}`, undefined, userToken);
    assert.equal(status, 403);
  });

  test('user cannot POST /servers/:id/start without "control" permission → 403', async () => {
    const { status } = await api('POST', `/servers/${testServerId}/start`, undefined, userToken);
    assert.equal(status, 403);
  });

  test('user cannot POST /servers/:id/stop without "control" permission → 403', async () => {
    const { status } = await api('POST', `/servers/${testServerId}/stop`, undefined, userToken);
    assert.equal(status, 403);
  });

  test('user cannot GET /servers/:id/metrics without "read" permission → 403', async () => {
    const { status } = await api('GET', `/servers/${testServerId}/metrics`, undefined, userToken);
    assert.equal(status, 403);
  });

  // ── Missing auth (401) ────────────────────────────────────────────────────

  test('GET /servers/:id without token → 401', async () => {
    const { status } = await api('GET', `/servers/${testServerId}`);
    assert.equal(status, 401);
  });

  test('GET /servers/:id/metrics without token → 401', async () => {
    const { status } = await api('GET', `/servers/${testServerId}/metrics`);
    assert.equal(status, 401);
  });

  // ── Admin override — admin bypasses ALL permission checks ─────────────────

  test('admin can GET /servers/:id without explicit permission → 200', async () => {
    const { status, body } = await api('GET', `/servers/${testServerId}`, undefined, adminToken);
    assert.equal(status, 200);
    assert.equal(body.data.id, testServerId);
  });

  test('admin POST /servers/:id/start bypasses permission → not 403/401', async () => {
    const { status } = await api('POST', `/servers/${testServerId}/start`, undefined, adminToken);
    assert.notEqual(status, 403);
    assert.notEqual(status, 401);
  });

  test('admin GET /servers/:id/metrics bypasses permission → 200', async () => {
    const { status } = await api('GET', `/servers/${testServerId}/metrics`, undefined, adminToken);
    assert.equal(status, 200);
  });

  // ── Admin-only user management ────────────────────────────────────────────

  test('regular user cannot POST /users → 403', async () => {
    const { status } = await api('POST', '/users', {
      email: 'extra@example.com', password: 'pass123', role: 'user',
    }, userToken);
    assert.equal(status, 403);
  });

  test('regular user cannot GET /users → 403', async () => {
    const { status } = await api('GET', '/users', undefined, userToken);
    assert.equal(status, 403);
  });

  test('admin can GET /users → 200', async () => {
    const { status, body } = await api('GET', '/users', undefined, adminToken);
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.data));
    assert.ok(body.data.length >= 2);
  });

  // ── Grant "read" permission, verify access ────────────────────────────────

  test('admin assigns { read: true, control: false } to user → 200', async () => {
    const { status, body } = await api('POST', '/permissions', {
      userId:      testUserId,
      serverId:    testServerId,
      permissions: { read: true, control: false },
    }, adminToken);
    assert.equal(status, 200);
    assert.equal(body.data.permissions.read,    true);
    assert.equal(body.data.permissions.control, false);
  });

  test('user can GET /servers/:id after "read" granted → 200', async () => {
    const { status, body } = await api('GET', `/servers/${testServerId}`, undefined, userToken);
    assert.equal(status, 200);
    assert.equal(body.data.id, testServerId);
  });

  test('user can GET /servers/:id/metrics after "read" granted → 200', async () => {
    const { status } = await api('GET', `/servers/${testServerId}/metrics`, undefined, userToken);
    assert.equal(status, 200);
  });

  // ── start/stop restrictions still enforced with only "read" ──────────────

  test('user with only "read" still cannot POST /servers/:id/start → 403', async () => {
    const { status } = await api('POST', `/servers/${testServerId}/start`, undefined, userToken);
    assert.equal(status, 403);
  });

  test('user with only "read" still cannot POST /servers/:id/stop → 403', async () => {
    const { status } = await api('POST', `/servers/${testServerId}/stop`, undefined, userToken);
    assert.equal(status, 403);
  });

  // ── Upsert: grant "control" and verify ───────────────────────────────────

  test('admin upserts { read: true, control: true } → 200 (idempotent upsert)', async () => {
    const { status, body } = await api('POST', '/permissions', {
      userId:      testUserId,
      serverId:    testServerId,
      permissions: { read: true, control: true },
    }, adminToken);
    assert.equal(status, 200);
    assert.equal(body.data.permissions.control, true);
  });

  // Upsert idempotency — calling again must not create a duplicate row
  test('second upsert with same userId+serverId does not duplicate → still 200', async () => {
    const { status, body } = await api('POST', '/permissions', {
      userId:      testUserId,
      serverId:    testServerId,
      permissions: { read: true, control: true },
    }, adminToken);
    assert.equal(status, 200);
    assert.equal(body.data.permissions.read,    true);
    assert.equal(body.data.permissions.control, true);
  });

  test('user with "control" passes start permission check → not 403/401', async () => {
    const { status } = await api('POST', `/servers/${testServerId}/start`, undefined, userToken);
    assert.notEqual(status, 403);
    assert.notEqual(status, 401);
  });

  test('user with "control" passes stop permission check → not 403/401', async () => {
    const { status } = await api('POST', `/servers/${testServerId}/stop`, undefined, userToken);
    assert.notEqual(status, 403);
    assert.notEqual(status, 401);
  });
});
