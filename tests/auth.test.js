'use strict';

/**
 * Auth integration tests.
 * Spawns the real app on an isolated port + DB with YAMS_AUTH_ENABLED=true.
 * The default admin is seeded automatically via YAMS_ADMIN_EMAIL / YAMS_ADMIN_PASSWORD.
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

const HTTP_PORT      = 3099;
const HTTP_TEST_DB   = path.join(os.tmpdir(), `yams-auth-${Date.now()}.db`);
const HTTP_TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'yams-auth-'));
const HTTP_BASE      = `http://localhost:${HTTP_PORT}`;

const ADMIN_EMAIL    = 'admin@auth-test.com';
const ADMIN_PASSWORD = 'adminpass123';

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
    proc.stderr.on('data', (chunk) => process.stderr.write(`[app-auth] ${chunk}`));
    proc.on('error', (err) => { clearTimeout(deadline); reject(err); });
    proc.on('exit', (code) => {
      if (code !== 0) { clearTimeout(deadline); reject(new Error(`App exited early (${code})`)); }
    });
  });
}

// ═════════════════════════════════════════════════════════════════════════════

describe('Auth — POST /auth/login', () => {
  let appProcess;

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
          JWT_SECRET:          'auth-test-secret',
          YAMS_AUTH_ENABLED:   'true',
          YAMS_ADMIN_EMAIL:    ADMIN_EMAIL,
          YAMS_ADMIN_PASSWORD: ADMIN_PASSWORD,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    await waitForApp(appProcess);
  });

  after(() => {
    appProcess?.kill();
    try { fs.rmSync(HTTP_TEST_ROOT, { recursive: true, force: true }); } catch {}
    for (const s of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(HTTP_TEST_DB + s); } catch {}
    }
  });

  test('login success — 200 with JWT token', async () => {
    const { status, body } = await api('POST', '/auth/login', {
      email:    ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    assert.equal(status, 200);
    assert.ok(body.data?.token, 'token present in response');
    assert.equal(typeof body.data.token, 'string');
  });

  test('login fail — wrong password → 401', async () => {
    const { status, body } = await api('POST', '/auth/login', {
      email:    ADMIN_EMAIL,
      password: 'wrong-password',
    });
    assert.equal(status, 401);
    assert.ok(body.error);
  });

  test('login fail — unknown email → 401', async () => {
    const { status, body } = await api('POST', '/auth/login', {
      email:    'nobody@example.com',
      password: ADMIN_PASSWORD,
    });
    assert.equal(status, 401);
    assert.ok(body.error);
  });

  test('login fail — missing fields → 400', async () => {
    const { status, body } = await api('POST', '/auth/login', {});
    assert.equal(status, 400);
    assert.ok(body.error);
  });
});
