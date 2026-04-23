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
      if (chunk.toString().includes('Running on')) {
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
// Unit tests (errors.js)
// ---------------------------------------------------------------------------

test('forbidden() returns AppError with statusCode 403', () => {
  const { forbidden } = require('./src/utils/errors');
  const err = forbidden('Access denied');
  assert.equal(err.statusCode, 403);
  assert.equal(err.isOperational, true);
  assert.equal(err.message, 'Access denied');
});

test('forbidden() uses default message when none provided', () => {
  const { forbidden } = require('./src/utils/errors');
  const err = forbidden();
  assert.equal(err.statusCode, 403);
  assert.equal(err.message, 'Forbidden');
});

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
    const { status, body } = await api('POST', '/does-not-exist');
    assert.equal(status, 404);
    assert.ok(body.error);
  });
});

// ─── fileService: test setup ──────────────────────────────────────────────────
const fsp  = require('node:fs/promises');

// Set YAMS_SERVERS_ROOT BEFORE requiring fileService so SERVERS_ROOT is correct.
const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'yams-test-'));
process.env.YAMS_SERVERS_ROOT = TEST_ROOT;

const TEST_SERVER_ID = 'srv-test-001';

async function setupServerDir(serverId = TEST_SERVER_ID) {
  const dir = path.join(TEST_ROOT, serverId);
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

process.on('exit', () => {
  try { fs.rmSync(TEST_ROOT, { recursive: true, force: true }); } catch {}
});

// ─── listDirectory ────────────────────────────────────────────────────────────
test('listDirectory returns files and directories with correct shape', async () => {
  const { listDirectory } = require('./src/services/fileService');
  const dir = await setupServerDir();

  await fsp.writeFile(path.join(dir, 'server.properties'), 'server-port=25565');
  await fsp.mkdir(path.join(dir, 'world'), { recursive: true });

  const result = await listDirectory(TEST_SERVER_ID, '');
  const names  = result.data.map(e => e.name);

  assert.ok(names.includes('server.properties'));
  assert.ok(names.includes('world'));

  const file   = result.data.find(e => e.name === 'server.properties');
  const folder = result.data.find(e => e.name === 'world');

  assert.equal(file.type, 'file');
  assert.ok(typeof file.size === 'number');
  assert.ok(typeof file.modified === 'number');
  assert.equal(folder.type, 'directory');
  assert.equal(typeof result.truncated, 'boolean');
});

test('listDirectory rejects path traversal with 403', async () => {
  const { listDirectory } = require('./src/services/fileService');
  await setupServerDir();

  await assert.rejects(
    () => listDirectory(TEST_SERVER_ID, '../other-server'),
    (err) => err.statusCode === 403
  );
});

test('listDirectory rejects absolute path with 403', async () => {
  const { listDirectory } = require('./src/services/fileService');
  await setupServerDir();

  await assert.rejects(
    () => listDirectory(TEST_SERVER_ID, '/etc/passwd'),
    (err) => err.statusCode === 403
  );
});

// ─── downloadFile ─────────────────────────────────────────────────────────────
test('downloadFile returns a readable stream and metadata', async () => {
  const { downloadFile } = require('./src/services/fileService');
  const dir = await setupServerDir();

  await fsp.writeFile(path.join(dir, 'eula.txt'), 'eula=true');

  const result = await downloadFile(TEST_SERVER_ID, 'eula.txt');
  assert.ok(result.stream,                        'should return a stream');
  assert.equal(result.filename, 'eula.txt');
  assert.ok(typeof result.contentType === 'string');
  assert.ok(typeof result.size === 'number');

  const chunks = [];
  await new Promise((resolve, reject) => {
    result.stream.on('data', c => chunks.push(c));
    result.stream.on('end', resolve);
    result.stream.on('error', reject);
  });
  assert.equal(Buffer.concat(chunks).toString(), 'eula=true');
});

test('downloadFile rejects a directory with 400', async () => {
  const { downloadFile } = require('./src/services/fileService');
  const dir = await setupServerDir();
  await fsp.mkdir(path.join(dir, 'plugins'), { recursive: true });

  await assert.rejects(
    () => downloadFile(TEST_SERVER_ID, 'plugins'),
    (err) => err.statusCode === 400
  );
});

test('downloadFile rejects path traversal with 403', async () => {
  const { downloadFile } = require('./src/services/fileService');
  await setupServerDir();

  await assert.rejects(
    () => downloadFile(TEST_SERVER_ID, '../../../etc/passwd'),
    (err) => err.statusCode === 403
  );
});

// ─── uploadFile ───────────────────────────────────────────────────────────────
const { Readable } = require('node:stream');

function buildMultipart(filename, content) {
  const boundary = '----TestBoundary7777';
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`
    ),
    Buffer.isBuffer(content) ? content : Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, boundary };
}

function fakeReq(body, boundary) {
  const stream = Readable.from([body]);
  stream.headers = {
    'content-type':   `multipart/form-data; boundary=${boundary}`,
    'content-length': String(body.length),
  };
  return stream;
}

test('uploadFile saves a file to the server directory', async () => {
  const { uploadFile } = require('./src/services/fileService');
  const dir = await setupServerDir();

  const { body, boundary } = buildMultipart('uploaded.txt', 'hello world');
  await uploadFile(TEST_SERVER_ID, '', fakeReq(body, boundary), false);

  const content = await fsp.readFile(path.join(dir, 'uploaded.txt'), 'utf8');
  assert.equal(content, 'hello world');
});

test('uploadFile returns 409 if file exists and overwrite=false', async () => {
  const { uploadFile } = require('./src/services/fileService');
  const dir = await setupServerDir();
  await fsp.writeFile(path.join(dir, 'existing.txt'), 'original');

  const { body, boundary } = buildMultipart('existing.txt', 'new content');
  await assert.rejects(
    () => uploadFile(TEST_SERVER_ID, '', fakeReq(body, boundary), false),
    (err) => err.statusCode === 409
  );

  const content = await fsp.readFile(path.join(dir, 'existing.txt'), 'utf8');
  assert.equal(content, 'original', 'Original file must be untouched');
});

test('uploadFile overwrites if overwrite=true', async () => {
  const { uploadFile } = require('./src/services/fileService');
  const dir = await setupServerDir();
  await fsp.writeFile(path.join(dir, 'replace-me.txt'), 'original');

  const { body, boundary } = buildMultipart('replace-me.txt', 'replaced');
  await uploadFile(TEST_SERVER_ID, '', fakeReq(body, boundary), true);

  const content = await fsp.readFile(path.join(dir, 'replace-me.txt'), 'utf8');
  assert.equal(content, 'replaced');
});

// ─── createFolder ─────────────────────────────────────────────────────────────
test('createFolder creates a nested directory', async () => {
  const { createFolder } = require('./src/services/fileService');
  const dir = await setupServerDir();

  await createFolder(TEST_SERVER_ID, 'plugins/myplugin');

  const stat = await fsp.stat(path.join(dir, 'plugins', 'myplugin'));
  assert.ok(stat.isDirectory());
});

test('createFolder is idempotent when directory already exists', async () => {
  const { createFolder } = require('./src/services/fileService');
  const dir = await setupServerDir();
  await fsp.mkdir(path.join(dir, 'already'), { recursive: true });

  // Must not throw
  await createFolder(TEST_SERVER_ID, 'already');
});

test('createFolder rejects path traversal with 403', async () => {
  const { createFolder } = require('./src/services/fileService');
  await setupServerDir();

  await assert.rejects(
    () => createFolder(TEST_SERVER_ID, '../escape'),
    (err) => err.statusCode === 403
  );
});

// ─── renameFile ───────────────────────────────────────────────────────────────
test('renameFile moves a file within the server root', async () => {
  const { renameFile } = require('./src/services/fileService');
  const dir = await setupServerDir();
  await fsp.writeFile(path.join(dir, 'src-rename.txt'), 'data');

  await renameFile(TEST_SERVER_ID, 'src-rename.txt', 'dst-rename.txt');

  await assert.rejects(() => fsp.access(path.join(dir, 'src-rename.txt')));
  const content = await fsp.readFile(path.join(dir, 'dst-rename.txt'), 'utf8');
  assert.equal(content, 'data');
});

test('renameFile rejects traversal in `from` with 403', async () => {
  const { renameFile } = require('./src/services/fileService');
  await setupServerDir();

  await assert.rejects(
    () => renameFile(TEST_SERVER_ID, '../../etc/passwd', 'safe.txt'),
    (err) => err.statusCode === 403
  );
});

test('renameFile rejects renaming server root with 403', async () => {
  const { renameFile } = require('./src/services/fileService');
  await setupServerDir();

  await assert.rejects(
    () => renameFile(TEST_SERVER_ID, '', 'new-name'),
    (err) => err.statusCode === 403
  );
});

// ─── deleteFile ───────────────────────────────────────────────────────────────
test('deleteFile removes a file', async () => {
  const { deleteFile } = require('./src/services/fileService');
  const dir = await setupServerDir();
  await fsp.writeFile(path.join(dir, 'delete-me.txt'), 'bye');

  await deleteFile(TEST_SERVER_ID, 'delete-me.txt');

  await assert.rejects(() => fsp.access(path.join(dir, 'delete-me.txt')));
});

test('deleteFile removes a directory recursively', async () => {
  const { deleteFile } = require('./src/services/fileService');
  const dir = await setupServerDir();
  await fsp.mkdir(path.join(dir, 'old-world', 'region'), { recursive: true });
  await fsp.writeFile(path.join(dir, 'old-world', 'region', 'r.0.0.mca'), '');

  await deleteFile(TEST_SERVER_ID, 'old-world');

  await assert.rejects(() => fsp.access(path.join(dir, 'old-world')));
});

test('deleteFile rejects deletion of server root via empty string with 403', async () => {
  const { deleteFile } = require('./src/services/fileService');
  await setupServerDir();

  await assert.rejects(
    () => deleteFile(TEST_SERVER_ID, ''),
    (err) => err.statusCode === 403
  );
});

test('deleteFile rejects path traversal with 403', async () => {
  const { deleteFile } = require('./src/services/fileService');
  await setupServerDir();

  await assert.rejects(
    () => deleteFile(TEST_SERVER_ID, '../other-server'),
    (err) => err.statusCode === 403
  );
});

// ─── Security: path traversal ─────────────────────────────────────────────────
test('security: listDirectory blocks all traversal payloads', async () => {
  const { listDirectory } = require('./src/services/fileService');
  await setupServerDir();

  const payloads = [
    '../',
    '../../',
    '../../../etc',
    'subdir/../../../../etc',
    '/etc/passwd',
    '/etc',
  ];

  for (const p of payloads) {
    await assert.rejects(
      () => listDirectory(TEST_SERVER_ID, p),
      (err) => err.statusCode === 403,
      `Expected 403 for payload: ${JSON.stringify(p)}`
    );
  }
});

test('security: cannot access another server via path traversal', async () => {
  const { listDirectory } = require('./src/services/fileService');

  const SERVER_A = 'server-alpha';
  const SERVER_B = 'server-beta';
  await fsp.mkdir(path.join(TEST_ROOT, SERVER_A), { recursive: true });
  await fsp.mkdir(path.join(TEST_ROOT, SERVER_B), { recursive: true });
  await fsp.writeFile(path.join(TEST_ROOT, SERVER_B, 'secret.txt'), 'secret');

  await assert.rejects(
    () => listDirectory(SERVER_A, '../server-beta'),
    (err) => err.statusCode === 403
  );
});

// ─── Security: symlink rejection ──────────────────────────────────────────────
test('security: symlink in download path is rejected with 403', async () => {
  const { downloadFile } = require('./src/services/fileService');
  const dir = await setupServerDir();

  await fsp.writeFile(path.join(dir, 'real.txt'), 'real content');
  try {
    await fsp.symlink(path.join(dir, 'real.txt'), path.join(dir, 'link.txt'));
  } catch {
    // Symlinks not supported in this environment — skip
    return;
  }

  await assert.rejects(
    () => downloadFile(TEST_SERVER_ID, 'link.txt'),
    (err) => err.statusCode === 403
  );
});

test('security: symlink in delete path is rejected with 403', async () => {
  const { deleteFile } = require('./src/services/fileService');
  const dir = await setupServerDir();

  await fsp.writeFile(path.join(dir, 'real-del.txt'), 'real');
  try {
    await fsp.symlink(path.join(dir, 'real-del.txt'), path.join(dir, 'link-del.txt'));
  } catch {
    return;
  }

  await assert.rejects(
    () => deleteFile(TEST_SERVER_ID, 'link-del.txt'),
    (err) => err.statusCode === 403
  );
});

// ─── Security: root deletion ──────────────────────────────────────────────────
test('security: deleteFile rejects server root via empty string', async () => {
  const { deleteFile } = require('./src/services/fileService');
  await setupServerDir();

  await assert.rejects(
    () => deleteFile(TEST_SERVER_ID, ''),
    (err) => err.statusCode === 403
  );
});

test('security: deleteFile rejects server root via dot', async () => {
  const { deleteFile } = require('./src/services/fileService');
  await setupServerDir();

  await assert.rejects(
    () => deleteFile(TEST_SERVER_ID, '.'),
    (err) => err.statusCode === 403
  );
});

test('security: renameFile rejects server root via empty string', async () => {
  const { renameFile } = require('./src/services/fileService');
  await setupServerDir();

  await assert.rejects(
    () => renameFile(TEST_SERVER_ID, '', 'new-name'),
    (err) => err.statusCode === 403
  );
});

