'use strict';

/**
 * YAMS Integration Tests
 *
 * Spawns the real app as a child process on a test port with an isolated DB
 * and temp servers directory. Tests run against the live HTTP server using
 * Node's built-in fetch, node:test, and node:assert — no external test libs.
 *
 * Run: npm test
 */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ---------------------------------------------------------------------------
// Test configuration
// ---------------------------------------------------------------------------

const TEST_PORT = 3001;
const TEST_DB = path.join(os.tmpdir(), `yams-test-${Date.now()}.db`);
const TEST_SERVERS_ROOT = path.join(os.tmpdir(), `yams-test-servers-${Date.now()}`);
const BASE_URL = `http://localhost:${TEST_PORT}`;

let serverProcess;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Make an HTTP request to the test server.
 * @param {'GET'|'POST'|'DELETE'} method
 * @param {string} endpoint  e.g. '/servers'
 * @param {object} [body]
 * @returns {{ status: number, body: any }}
 */
async function api(method, endpoint, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${endpoint}`, opts);
  const json = await res.json();
  return { status: res.status, body: json };
}

/**
 * Wait until the test server is accepting connections (max 6 s).
 */
function waitForServer(timeout = 6000) {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('Test server did not start in time')), timeout);

    serverProcess.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('running on')) {
        clearTimeout(deadline);
        resolve();
      }
    });

    serverProcess.stderr.on('data', (chunk) => {
      // Print stderr so we see any startup errors
      process.stderr.write(`[app stderr] ${chunk}`);
    });

    serverProcess.on('error', (err) => {
      clearTimeout(deadline);
      reject(err);
    });

    serverProcess.on('exit', (code) => {
      if (code !== 0) {
        clearTimeout(deadline);
        reject(new Error(`App exited with code ${code} before tests could run`));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

before(async () => {
  serverProcess = spawn(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', 'app.js'],
    {
      cwd: __dirname,
      env: {
        ...process.env,
        PORT: String(TEST_PORT),
        YAMS_DB: TEST_DB,
        YAMS_SERVERS_ROOT: TEST_SERVERS_ROOT,
      },
      // Pipe stdout so we can detect the ready message
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  await waitForServer();
});

after(() => {
  serverProcess.kill();

  // Remove test DB and WAL files
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB + suffix); } catch { /* ignore */ }
  }

  // Remove temp servers directory
  try { fs.rmSync(TEST_SERVERS_ROOT, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Track the created server UUID across tests
let createdServerId;

describe('GET /servers', () => {
  test('returns an empty array when no servers exist', async () => {
    const { status, body } = await api('GET', '/servers');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.data));
    assert.equal(body.data.length, 0);
  });
});

describe('POST /servers — validation errors', () => {
  test('400 when name is missing', async () => {
    const { status, body } = await api('POST', '/servers', { port: 25565, ram: '1G' });
    assert.equal(status, 400);
    assert.ok(body.error);
  });

  test('400 when port is missing', async () => {
    const { status, body } = await api('POST', '/servers', { name: 'test', ram: '1G' });
    assert.equal(status, 400);
    assert.ok(body.error);
  });

  test('400 when name is too short (< 3 chars)', async () => {
    const { status, body } = await api('POST', '/servers', { name: 'ab', port: 25565, ram: '1G' });
    assert.equal(status, 400);
    assert.ok(body.error);
  });

  test('400 when name starts with a digit', async () => {
    const { status, body } = await api('POST', '/servers', { name: '1server', port: 25565, ram: '1G' });
    assert.equal(status, 400);
    assert.ok(body.error);
  });

  test('400 when name contains spaces', async () => {
    const { status, body } = await api('POST', '/servers', { name: 'my server', port: 25565, ram: '1G' });
    assert.equal(status, 400);
    assert.ok(body.error);
  });

  test('400 when port is below 1024', async () => {
    const { status, body } = await api('POST', '/servers', { name: 'testserver', port: 80, ram: '1G' });
    assert.equal(status, 400);
    assert.ok(body.error);
  });

  test('400 when port is above 65535', async () => {
    const { status, body } = await api('POST', '/servers', { name: 'testserver', port: 99999, ram: '1G' });
    assert.equal(status, 400);
    assert.ok(body.error);
  });

  test('400 when ram format is invalid (e.g. "2GB" instead of "2G")', async () => {
    const { status, body } = await api('POST', '/servers', { name: 'testserver', port: 25565, ram: '2GB' });
    assert.equal(status, 400);
    assert.ok(body.error);
  });

  test('400 when ram is a plain number without unit', async () => {
    const { status, body } = await api('POST', '/servers', { name: 'testserver', port: 25565, ram: '1024' });
    assert.equal(status, 400);
    assert.ok(body.error);
  });
});

describe('POST /servers — successful creation', () => {
  test('201 creates a server with correct fields', async () => {
    const { status, body } = await api('POST', '/servers', {
      name: 'survival',
      port: 25565,
      ram: '2G',
    });

    assert.equal(status, 201);
    assert.ok(body.data.id, 'should have an id (UUID)');
    assert.equal(body.data.name, 'survival');
    assert.equal(body.data.port, 25565);
    assert.equal(body.data.ram, '2G');
    assert.equal(body.data.status, 'stopped');
    assert.equal(body.data.pid, null);
    assert.ok(body.data.path, 'should have a path');

    createdServerId = body.data.id;
  });

  test('creates eula.txt in the server directory', () => {
    const eulaPath = path.join(TEST_SERVERS_ROOT, 'survival', 'eula.txt');
    assert.ok(fs.existsSync(eulaPath), 'eula.txt should exist');
    const content = fs.readFileSync(eulaPath, 'utf8');
    assert.ok(content.includes('eula=true'), 'eula.txt should contain eula=true');
  });

  test('creates server.properties in the server directory', () => {
    const propsPath = path.join(TEST_SERVERS_ROOT, 'survival', 'server.properties');
    assert.ok(fs.existsSync(propsPath), 'server.properties should exist');
    const content = fs.readFileSync(propsPath, 'utf8');
    assert.ok(content.includes('server-port=25565'), 'server.properties should set correct port');
    assert.ok(content.includes('online-mode=false'), 'server.properties should set online-mode=false');
  });

  test('201 creates a second server with different name and port', async () => {
    const { status, body } = await api('POST', '/servers', {
      name: 'creative',
      port: 25566,
      ram: '1G',
    });
    assert.equal(status, 201);
    assert.equal(body.data.name, 'creative');
  });

  test('ram defaults to 1G when not provided', async () => {
    const { status, body } = await api('POST', '/servers', {
      name: 'minigames',
      port: 25567,
    });
    assert.equal(status, 201);
    assert.equal(body.data.ram, '1G');
  });
});

describe('POST /servers — conflict errors', () => {
  test('409 when port is already in use', async () => {
    const { status, body } = await api('POST', '/servers', {
      name: 'another-server',
      port: 25565, // taken by 'survival'
      ram: '1G',
    });
    assert.equal(status, 409);
    assert.ok(body.error.toLowerCase().includes('port'));
  });

  test('409 when name is already taken', async () => {
    const { status, body } = await api('POST', '/servers', {
      name: 'survival', // already exists
      port: 25599,
      ram: '1G',
    });
    assert.equal(status, 409);
    assert.ok(body.error.toLowerCase().includes('survival'));
  });
});

describe('GET /servers', () => {
  test('returns all created servers', async () => {
    const { status, body } = await api('GET', '/servers');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.data));
    // We created: survival, creative, minigames
    assert.equal(body.data.length, 3);
  });
});

describe('GET /servers/:id', () => {
  test('200 returns the correct server by id', async () => {
    const { status, body } = await api('GET', `/servers/${createdServerId}`);
    assert.equal(status, 200);
    assert.equal(body.data.id, createdServerId);
    assert.equal(body.data.name, 'survival');
  });

  test('404 for a non-existent UUID', async () => {
    const { status, body } = await api('GET', '/servers/00000000-0000-0000-0000-000000000000');
    assert.equal(status, 404);
    assert.ok(body.error);
  });

  test('404 for a completely invalid id', async () => {
    const { status } = await api('GET', '/servers/not-a-real-id');
    assert.equal(status, 404);
  });
});

describe('POST /servers/:id/start', () => {
  test('404 for a non-existent server', async () => {
    const { status, body } = await api('POST', '/servers/00000000-0000-0000-0000-000000000000/start');
    assert.equal(status, 404);
    assert.ok(body.error);
  });

  test('400 when server.jar is missing', async () => {
    // server.jar has not been placed — this is the expected path for new servers
    const { status, body } = await api('POST', `/servers/${createdServerId}/start`);
    assert.equal(status, 400);
    assert.ok(body.error.toLowerCase().includes('server.jar'));
    // The error should include the expected path so the user knows where to put it
    assert.ok(body.error.includes('server.jar'));
  });
});

describe('POST /servers/:id/stop', () => {
  test('404 for a non-existent server', async () => {
    const { status, body } = await api('POST', '/servers/00000000-0000-0000-0000-000000000000/stop');
    assert.equal(status, 404);
    assert.ok(body.error);
  });

  test('409 when server is not running', async () => {
    const { status, body } = await api('POST', `/servers/${createdServerId}/stop`);
    assert.equal(status, 409);
    assert.ok(body.error.toLowerCase().includes('not running'));
  });
});

describe('Unknown routes', () => {
  test('404 for routes that do not exist', async () => {
    const { status, body } = await api('GET', '/does-not-exist');
    assert.equal(status, 404);
    assert.ok(body.error);
  });
});
