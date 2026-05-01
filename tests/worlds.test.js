'use strict';

/**
 * Integration tests — Worlds Backend module.
 *
 * Tests worldService functions directly against a real temp filesystem
 * and an isolated SQLite DB. No HTTP server required.
 *
 * Run: npm test   (node --test test.js tests/worlds.test.js)
 */

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const { Readable, Writable } = require('stream');
const path   = require('path');
const fs     = require('fs');
const fsp    = require('fs/promises');
const os     = require('os');
const { v4: uuidv4 } = require('uuid');
const archiver  = require('archiver');
const unzipper  = require('unzipper');

// ─── Env setup — MUST precede any module that reads env at load time ──────────

const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'yams-worlds-'));
const TEST_DB   = path.join(os.tmpdir(), `yams-worlds-${Date.now()}.db`);

process.env.YAMS_SERVERS_ROOT = TEST_ROOT;
process.env.YAMS_DB           = TEST_DB;

// Safe to require now
const worldService = require('../src/services/worldService');
const serverModel  = require('../src/models/serverModel');

// ─── Cleanup ──────────────────────────────────────────────────────────────────

after(() => {
  try { fs.rmSync(TEST_ROOT, { recursive: true, force: true }); } catch {}
  for (const s of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB + s); } catch {}
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _portSeq = 20000;

/** Create a temp server directory + DB record. */
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

/**
 * Create a Minecraft world directory with the given markers.
 * markers: ['level.dat'] for file, ['region/'] for dir.
 */
async function makeWorld(serverDir, name, markers = ['level.dat']) {
  const worldPath = path.join(serverDir, name);
  await fsp.mkdir(worldPath, { recursive: true });
  for (const m of markers) {
    if (m.endsWith('/')) {
      await fsp.mkdir(path.join(worldPath, m.slice(0, -1)), { recursive: true });
    } else {
      await fsp.writeFile(path.join(worldPath, m), 'fake', 'utf8');
    }
  }
  return worldPath;
}

/** Write server.properties content to a server dir. */
async function makeProps(serverDir, content) {
  await fsp.writeFile(path.join(serverDir, 'server.properties'), content, 'utf8');
}

/** Build an in-memory ZIP buffer from a list of { entryPath, content? } entries. */
function buildZip(entries) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const arc = archiver('zip');
    arc.on('data', c => chunks.push(c));
    arc.on('end',  () => resolve(Buffer.concat(chunks)));
    arc.on('error', reject);
    for (const e of entries) {
      arc.append(Buffer.from(e.content ?? 'fake'), { name: e.entryPath });
    }
    arc.finalize();
  });
}

/**
 * Build a raw ZIP binary that contains a path traversal entry.
 * archiver normalises '../' at creation time, so we must craft the bytes manually
 * to test the server-side zip-slip guard (which reads raw entry paths via unzipper).
 */
function buildZipSlipZip() {
  function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (const b of buf) {
      crc ^= b;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  const filename = Buffer.from('../evil.txt');
  const content  = Buffer.from('evil');
  const crc      = crc32(content);
  const localOffset = 0;

  // Local file header (30 bytes + filename)
  const lh = Buffer.alloc(30 + filename.length);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);
  lh.writeUInt16LE(0, 6);
  lh.writeUInt16LE(0, 8);   // stored (no compression)
  lh.writeUInt16LE(0, 10);  lh.writeUInt16LE(0, 12);
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(content.length, 18);
  lh.writeUInt32LE(content.length, 22);
  lh.writeUInt16LE(filename.length, 26);
  lh.writeUInt16LE(0, 28);
  filename.copy(lh, 30);

  // Central directory (46 bytes + filename)
  const cd = Buffer.alloc(46 + filename.length);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(0, 8);   cd.writeUInt16LE(0, 10);
  cd.writeUInt16LE(0, 12);  cd.writeUInt16LE(0, 14);
  cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(content.length, 20);
  cd.writeUInt32LE(content.length, 24);
  cd.writeUInt16LE(filename.length, 28);
  cd.writeUInt16LE(0, 30);  cd.writeUInt16LE(0, 32);
  cd.writeUInt16LE(0, 34);  cd.writeUInt16LE(0, 36);
  cd.writeUInt32LE(0, 38);  cd.writeUInt32LE(localOffset, 42);
  filename.copy(cd, 46);

  const cdOffset = lh.length + content.length;

  // End of central directory
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([lh, content, cd, eocd]);
}

/**
 * Wrap a zip buffer in a multipart/form-data Readable (busboy-compatible).
 * worldName: optional `name` field; if null the service uses the filename stem.
 */
function buildImportReq(zipBuffer, { filename = 'world.zip', worldName = null } = {}) {
  const boundary = 'WorldTestBoundary' + Date.now();
  const parts    = [];

  if (worldName !== null) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${worldName}\r\n`
    ));
  }

  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="world"; filename="${filename}"\r\n` +
    `Content-Type: application/zip\r\n\r\n`
  ));
  parts.push(zipBuffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  const body = Buffer.concat(parts);
  const req  = Readable.from([body]);
  req.headers = {
    'content-type':   `multipart/form-data; boundary=${boundary}`,
    'content-length': String(body.length),
  };
  return req;
}

/**
 * Writable stream that collects data — used as a fake `res` for exportWorld.
 * exportWorld does archive.pipe(res) then awaits res.on('finish').
 */
class FakeRes extends Writable {
  constructor() {
    super();
    this.headers      = {};
    this._isDestroyed = false;
  }
  _write(chunk, _, cb) { this._chunks = (this._chunks || []); this._chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); cb(); }
  setHeader(k, v) { this.headers[k] = v; }
  destroy(err)    { this._isDestroyed = true; super.destroy(err); }
  getBuffer()     { return Buffer.concat(this._chunks || []); }
}

// ─── A: listWorlds ────────────────────────────────────────────────────────────

describe('listWorlds', () => {
  test('returns empty array when server dir has no world-like entries', async () => {
    const { serverDir } = await makeServer();
    assert.deepEqual(await worldService.listWorlds(serverDir), []);
  });

  test('includes only directories with at least one Minecraft marker', async () => {
    const { serverDir } = await makeServer();
    await makeWorld(serverDir, 'valid-world',  ['level.dat']);
    await makeWorld(serverDir, 'region-world', ['region/']);
    await fsp.mkdir(path.join(serverDir, 'no-markers'), { recursive: true });
    await fsp.writeFile(path.join(serverDir, 'no-markers', 'config.yml'), 'fake');

    const names = (await worldService.listWorlds(serverDir)).map(w => w.name);
    assert.ok(names.includes('valid-world'),  'level.dat world must be listed');
    assert.ok(names.includes('region-world'), 'region/ world must be listed');
    assert.ok(!names.includes('no-markers'),  'dir without markers must not be listed');
  });

  test('never exposes blacklisted directories', async () => {
    const { serverDir } = await makeServer();
    // Give each blacklisted dir markers — they must still be excluded
    for (const name of ['plugins', 'mods', 'logs', 'backups', 'config', 'crash-reports']) {
      const dir = path.join(serverDir, name);
      await fsp.mkdir(path.join(dir, 'region'), { recursive: true });
      await fsp.writeFile(path.join(dir, 'level.dat'), 'fake');
    }
    assert.deepEqual(await worldService.listWorlds(serverDir), []);
  });

  test('active flag is correct from level-name in server.properties', async () => {
    const { serverDir } = await makeServer();
    await makeWorld(serverDir, 'worldA');
    await makeWorld(serverDir, 'worldB');
    await makeProps(serverDir, 'level-name=worldB\n');

    const result = await worldService.listWorlds(serverDir);
    assert.equal(result.find(w => w.name === 'worldB').active, true);
    assert.equal(result.find(w => w.name === 'worldA').active, false);
  });

  test('no world has active:true when level-name points to nonexistent directory', async () => {
    const { serverDir } = await makeServer();
    await makeWorld(serverDir, 'world');
    await makeProps(serverDir, 'level-name=ghost\n');

    const result = await worldService.listWorlds(serverDir);
    assert.ok(result.every(w => !w.active), 'no world should be active');
  });

  test('no world has active:true when level-name points to dir without markers', async () => {
    const { serverDir } = await makeServer();
    await makeWorld(serverDir, 'world');
    await fsp.mkdir(path.join(serverDir, 'empty-dir'), { recursive: true });
    await makeProps(serverDir, 'level-name=empty-dir\n');

    const result = await worldService.listWorlds(serverDir);
    assert.ok(result.every(w => !w.active), 'no world should be active');
    assert.ok(!result.find(w => w.name === 'empty-dir'), 'invalid dir must not appear');
  });

  test('sorts: active world first, then alphabetical among others', async () => {
    const { serverDir } = await makeServer();
    await makeWorld(serverDir, 'alpha');
    await makeWorld(serverDir, 'zeta');
    await makeWorld(serverDir, 'middle');
    await makeProps(serverDir, 'level-name=zeta\n');

    const names = (await worldService.listWorlds(serverDir)).map(w => w.name);
    assert.equal(names[0], 'zeta',   'active world must be first');
    assert.equal(names[1], 'alpha',  'alphabetical after active');
    assert.equal(names[2], 'middle', 'alphabetical after active');
  });

  test('size is null on cold cache (no prior computation)', async () => {
    const { serverDir } = await makeServer();
    await makeWorld(serverDir, 'uncached');
    const result = await worldService.listWorlds(serverDir);
    assert.equal(result[0].size, null);
  });

  test('detects DIM-1/ and DIM1/ as valid secondary markers', async () => {
    const { serverDir } = await makeServer();
    await makeWorld(serverDir, 'nether', ['DIM-1/']);
    await makeWorld(serverDir, 'end',    ['DIM1/']);

    const names = (await worldService.listWorlds(serverDir)).map(w => w.name);
    assert.ok(names.includes('nether'), 'DIM-1/ must be detected');
    assert.ok(names.includes('end'),    'DIM1/ must be detected');
  });

  test('ignores symlinked world directories', async () => {
    const { serverDir } = await makeServer();
    const real = path.join(TEST_ROOT, `real-${uuidv4()}`);
    await fsp.mkdir(path.join(real, 'region'), { recursive: true });
    await fsp.writeFile(path.join(real, 'level.dat'), 'fake');
    try {
      await fsp.symlink(real, path.join(serverDir, 'linked-world'));
    } catch { return; } // symlinks not supported — skip

    const names = (await worldService.listWorlds(serverDir)).map(w => w.name);
    assert.ok(!names.includes('linked-world'), 'symlink must not appear');
  });

  test('level-name raw value: spaces around = are NOT trimmed (active stays false)', async () => {
    // Spec v1.2: value is taken RAW — "level-name = world" gives levelName=" world" (leading space).
    // A world named "spaced" does not match levelName " spaced", so active:false.
    // This is intentional; setActiveWorld always writes without spaces (level-name=name).
    const { serverDir } = await makeServer();
    await makeWorld(serverDir, 'spaced');
    await makeProps(serverDir, 'level-name = spaced\n');

    const result = await worldService.listWorlds(serverDir);
    assert.ok(result.every(w => !w.active), 'raw value " spaced" does not match "spaced" — no active world');
  });
});

// ─── B: getWorld ──────────────────────────────────────────────────────────────

describe('getWorld', () => {
  test('returns correct world object for a valid world', async () => {
    const { serverDir } = await makeServer();
    await makeWorld(serverDir, 'world');
    await makeProps(serverDir, 'level-name=world\n');

    const w = await worldService.getWorld(serverDir, 'world');
    assert.equal(w.name, 'world');
    assert.equal(w.active, true);
    assert.ok('size' in w);
    assert.ok('updatedAt' in w);
  });

  test('404 WORLD_NOT_FOUND for non-existent directory', async () => {
    const { serverDir } = await makeServer();
    await assert.rejects(
      () => worldService.getWorld(serverDir, 'ghost'),
      e => e.statusCode === 404 && e.code === 'WORLD_NOT_FOUND'
    );
  });

  test('404 WORLD_NOT_FOUND for directory without markers', async () => {
    const { serverDir } = await makeServer();
    await fsp.mkdir(path.join(serverDir, 'notaworld'), { recursive: true });
    await assert.rejects(
      () => worldService.getWorld(serverDir, 'notaworld'),
      e => e.statusCode === 404 && e.code === 'WORLD_NOT_FOUND'
    );
  });

  test('400 INVALID_WORLD_NAME for path traversal (../)', async () => {
    const { serverDir } = await makeServer();
    await assert.rejects(
      () => worldService.getWorld(serverDir, '../escape'),
      e => e.statusCode === 400 && e.code === 'INVALID_WORLD_NAME'
    );
  });

  test('400 INVALID_WORLD_NAME for name containing slash', async () => {
    const { serverDir } = await makeServer();
    await assert.rejects(
      () => worldService.getWorld(serverDir, 'sub/dir'),
      e => e.statusCode === 400 && e.code === 'INVALID_WORLD_NAME'
    );
  });

  test('400 INVALID_WORLD_NAME for empty string', async () => {
    const { serverDir } = await makeServer();
    await assert.rejects(
      () => worldService.getWorld(serverDir, ''),
      e => e.statusCode === 400 && e.code === 'INVALID_WORLD_NAME'
    );
  });

  test('400 INVALID_WORLD_NAME for blacklisted name "plugins"', async () => {
    const { serverDir } = await makeServer();
    await fsp.mkdir(path.join(serverDir, 'plugins', 'region'), { recursive: true });
    await assert.rejects(
      () => worldService.getWorld(serverDir, 'plugins'),
      e => e.statusCode === 400 && e.code === 'INVALID_WORLD_NAME'
    );
  });

  test('404 WORLD_NOT_FOUND for symlinked world (symlinks not exposed)', async () => {
    const { serverDir } = await makeServer();
    const real = path.join(TEST_ROOT, `real-get-${uuidv4()}`);
    await fsp.mkdir(path.join(real, 'region'), { recursive: true });
    await fsp.writeFile(path.join(real, 'level.dat'), 'fake');
    try {
      await fsp.symlink(real, path.join(serverDir, 'sym'));
    } catch { return; }

    // isValidWorld rejects symlinks → notFound
    await assert.rejects(
      () => worldService.getWorld(serverDir, 'sym'),
      e => e.statusCode === 404 && e.code === 'WORLD_NOT_FOUND'
    );
  });
});

// ─── C: setActiveWorld ────────────────────────────────────────────────────────

describe('setActiveWorld', () => {
  test('updates level-name, preserves other keys and comments', async () => {
    const { serverId, serverDir } = await makeServer();
    await makeWorld(serverDir, 'newworld');
    await makeProps(serverDir, '#Generated\nserver-port=25565\nlevel-name=world\nonline-mode=false\n');

    await worldService.setActiveWorld(serverId, serverDir, 'newworld');

    const content = await fsp.readFile(path.join(serverDir, 'server.properties'), 'utf8');
    assert.ok(content.includes('level-name=newworld'), 'level-name must be updated');
    assert.ok(content.includes('server-port=25565'),   'other keys preserved');
    assert.ok(content.includes('online-mode=false'),   'other keys preserved');
    assert.ok(content.includes('#Generated'),          'comments preserved');
  });

  test('appends level-name when key is absent', async () => {
    const { serverId, serverDir } = await makeServer();
    await makeWorld(serverDir, 'newworld');
    await makeProps(serverDir, 'server-port=25565\n');

    await worldService.setActiveWorld(serverId, serverDir, 'newworld');

    const content = await fsp.readFile(path.join(serverDir, 'server.properties'), 'utf8');
    assert.ok(content.includes('level-name=newworld'));
    assert.ok(content.includes('server-port=25565'));
  });

  test('creates server.properties when it does not exist', async () => {
    const { serverId, serverDir } = await makeServer();
    const propsPath = path.join(serverDir, 'server.properties');
    await fsp.unlink(propsPath).catch(() => {});

    await worldService.setActiveWorld(serverId, serverDir, 'future');

    const content = await fsp.readFile(propsPath, 'utf8');
    assert.ok(content.includes('level-name=future'));
  });

  test('allows non-existent target world (Minecraft creates it on next start)', async () => {
    const { serverId, serverDir } = await makeServer();
    await makeProps(serverDir, 'level-name=world\n');

    await assert.doesNotReject(
      () => worldService.setActiveWorld(serverId, serverDir, 'future-world')
    );
    const content = await fsp.readFile(path.join(serverDir, 'server.properties'), 'utf8');
    assert.ok(content.includes('level-name=future-world'));
  });

  test('400 INVALID_WORLD when target directory exists but has no Minecraft markers', async () => {
    const { serverId, serverDir } = await makeServer();
    // Use a non-blacklisted name so validateName passes
    const badDir = path.join(serverDir, 'notaworld');
    await fsp.mkdir(badDir, { recursive: true });
    await fsp.writeFile(path.join(badDir, 'settings.yml'), 'fake');

    await assert.rejects(
      () => worldService.setActiveWorld(serverId, serverDir, 'notaworld'),
      e => e.statusCode === 400 && e.code === 'INVALID_WORLD'
    );
  });

  test('is idempotent when target is already the active world', async () => {
    const { serverId, serverDir } = await makeServer();
    await makeWorld(serverDir, 'world');
    await makeProps(serverDir, 'level-name=world\n');

    await assert.doesNotReject(
      () => worldService.setActiveWorld(serverId, serverDir, 'world')
    );
  });

  test('409 SERVER_RUNNING when server is running', async () => {
    const { serverId, serverDir } = await makeServer();
    serverModel.updateStatus(serverId, 'running', 99999);
    try {
      await assert.rejects(
        () => worldService.setActiveWorld(serverId, serverDir, 'world'),
        e => e.statusCode === 409 && e.code === 'SERVER_RUNNING'
      );
    } finally {
      serverModel.updateStatus(serverId, 'stopped', null);
    }
  });

  test('parses level-name with spaces around = correctly (split on first = only)', async () => {
    const { serverId, serverDir } = await makeServer();
    await makeWorld(serverDir, 'target');
    await makeProps(serverDir, 'level-name = world\n'); // spaces around =

    await worldService.setActiveWorld(serverId, serverDir, 'target');

    const content = await fsp.readFile(path.join(serverDir, 'server.properties'), 'utf8');
    assert.ok(content.includes('level-name=target'));
  });

  test('returns { active: name } on success', async () => {
    const { serverId, serverDir } = await makeServer();
    await makeWorld(serverDir, 'result-world');
    await makeProps(serverDir, 'level-name=world\n');

    const res = await worldService.setActiveWorld(serverId, serverDir, 'result-world');
    assert.deepEqual(res, { active: 'result-world' });
  });
});

// ─── D: deleteWorld ───────────────────────────────────────────────────────────

describe('deleteWorld', () => {
  test('deletes world directory from disk and returns void', async () => {
    const { serverId, serverDir } = await makeServer();
    await makeWorld(serverDir, 'active');
    await makeWorld(serverDir, 'todelete');
    await makeProps(serverDir, 'level-name=active\n');

    await worldService.deleteWorld(serverId, serverDir, 'todelete');

    await assert.rejects(
      () => fsp.access(path.join(serverDir, 'todelete')),
      'directory must be gone after deletion'
    );
  });

  test('409 ACTIVE_WORLD_PROTECTED when deleting the active world', async () => {
    const { serverId, serverDir } = await makeServer();
    await makeWorld(serverDir, 'active');
    await makeProps(serverDir, 'level-name=active\n');

    await assert.rejects(
      () => worldService.deleteWorld(serverId, serverDir, 'active'),
      e => e.statusCode === 409 && e.code === 'ACTIVE_WORLD_PROTECTED'
    );
    // World must still exist on disk
    assert.ok(fs.existsSync(path.join(serverDir, 'active')));
  });

  test('409 SERVER_RUNNING when server is running', async () => {
    const { serverId, serverDir } = await makeServer();
    await makeWorld(serverDir, 'main');
    await makeWorld(serverDir, 'other');
    await makeProps(serverDir, 'level-name=main\n');
    serverModel.updateStatus(serverId, 'running', 99999);

    try {
      await assert.rejects(
        () => worldService.deleteWorld(serverId, serverDir, 'other'),
        e => e.statusCode === 409 && e.code === 'SERVER_RUNNING'
      );
    } finally {
      serverModel.updateStatus(serverId, 'stopped', null);
    }
  });

  test('404 WORLD_NOT_FOUND for non-existent directory', async () => {
    const { serverId, serverDir } = await makeServer();
    await assert.rejects(
      () => worldService.deleteWorld(serverId, serverDir, 'ghost'),
      e => e.statusCode === 404 && e.code === 'WORLD_NOT_FOUND'
    );
  });

  test('404 WORLD_NOT_FOUND for directory without Minecraft markers', async () => {
    const { serverId, serverDir } = await makeServer();
    await fsp.mkdir(path.join(serverDir, 'emptydir'), { recursive: true });
    await assert.rejects(
      () => worldService.deleteWorld(serverId, serverDir, 'emptydir'),
      e => e.statusCode === 404 && e.code === 'WORLD_NOT_FOUND'
    );
  });

  test('400 SYMLINK_FORBIDDEN for symlinked world — real world untouched', async () => {
    const { serverId, serverDir } = await makeServer();
    const real = path.join(TEST_ROOT, `real-del-${uuidv4()}`);
    await fsp.mkdir(real, { recursive: true });
    await fsp.writeFile(path.join(real, 'level.dat'), 'real-data');
    await makeProps(serverDir, 'level-name=main\n');
    await makeWorld(serverDir, 'main');
    try {
      await fsp.symlink(real, path.join(serverDir, 'sym-del'));
    } catch { return; }

    await assert.rejects(
      () => worldService.deleteWorld(serverId, serverDir, 'sym-del'),
      e => e.statusCode === 400 && e.code === 'SYMLINK_FORBIDDEN'
    );
    // Real directory must be untouched
    assert.ok(fs.existsSync(path.join(real, 'level.dat')));
  });
});

// ─── E: importWorld ───────────────────────────────────────────────────────────

describe('importWorld', () => {
  test('accepts flat ZIP (Minecraft markers at archive root)', async () => {
    const { serverId, serverDir } = await makeServer();
    const zip = await buildZip([
      { entryPath: 'level.dat',        content: 'nbt-data' },
      { entryPath: 'region/r.0.0.mca', content: 'chunk'    },
    ]);
    const req = buildImportReq(zip, { worldName: 'flat-world' });

    const result = await worldService.importWorld(serverId, serverDir, req);

    assert.equal(result.name, 'flat-world');
    assert.equal(result.active, false);
    assert.ok(fs.existsSync(path.join(serverDir, 'flat-world', 'level.dat')));
    assert.ok(fs.existsSync(path.join(serverDir, 'flat-world', 'region', 'r.0.0.mca')));
  });

  test('accepts wrapped ZIP (single root directory)', async () => {
    const { serverId, serverDir } = await makeServer();
    const zip = await buildZip([
      { entryPath: 'my-world/level.dat',        content: 'nbt' },
      { entryPath: 'my-world/region/r.0.0.mca', content: 'chunk' },
    ]);
    const req = buildImportReq(zip, { worldName: 'wrapped-world' });

    const result = await worldService.importWorld(serverId, serverDir, req);

    assert.equal(result.name, 'wrapped-world');
    assert.ok(fs.existsSync(path.join(serverDir, 'wrapped-world', 'level.dat')));
  });

  test('wrapped ZIP: silently filters non-Minecraft files', async () => {
    const { serverId, serverDir } = await makeServer();
    const zip = await buildZip([
      { entryPath: 'pack/level.dat',  content: 'nbt'     },
      { entryPath: 'pack/README.md',  content: '# readme' },
      { entryPath: 'pack/.gitignore', content: 'ignore'   },
    ]);
    const req = buildImportReq(zip, { worldName: 'filtered-world' });

    await worldService.importWorld(serverId, serverDir, req);

    assert.ok(fs.existsSync(path.join(serverDir, 'filtered-world', 'level.dat')));
    assert.ok(!fs.existsSync(path.join(serverDir, 'filtered-world', 'README.md')));
  });

  test('uses filename stem as world name when no name field provided', async () => {
    const { serverId, serverDir } = await makeServer();
    const zip = await buildZip([{ entryPath: 'level.dat', content: 'fake' }]);
    const req = buildImportReq(zip, { filename: 'auto-named.zip' }); // worldName: null

    const result = await worldService.importWorld(serverId, serverDir, req);
    assert.equal(result.name, 'auto-named');
    assert.ok(fs.existsSync(path.join(serverDir, 'auto-named', 'level.dat')));
  });

  test('400 AMBIGUOUS_ARCHIVE_STRUCTURE for multi-root ZIP', async () => {
    const { serverId, serverDir } = await makeServer();
    const zip = await buildZip([
      { entryPath: 'world-a/level.dat', content: 'fake' },
      { entryPath: 'world-b/level.dat', content: 'fake' },
    ]);
    const req = buildImportReq(zip, { worldName: 'multi-root' });

    await assert.rejects(
      () => worldService.importWorld(serverId, serverDir, req),
      e => e.statusCode === 400 && e.code === 'AMBIGUOUS_ARCHIVE_STRUCTURE'
    );
  });

  test('400 ZIP_SLIP_DETECTED for archive containing path traversal entry', async () => {
    // archiver normalises "../" at creation time, so we craft the raw ZIP bytes
    // manually to produce an entry path that unzipper reads back as "../evil.txt".
    const { serverId, serverDir } = await makeServer();
    const zip = buildZipSlipZip(); // raw bytes with "../evil.txt" entry
    const req = buildImportReq(zip, { worldName: 'slipped' });

    await assert.rejects(
      () => worldService.importWorld(serverId, serverDir, req),
      e => e.statusCode === 400 && e.code === 'ZIP_SLIP_DETECTED'
    );
  });

  test('400 ARCHIVE_CORRUPTED for non-zip payload', async () => {
    const { serverId, serverDir } = await makeServer();
    const req = buildImportReq(Buffer.from('NOT A ZIP FILE'), {
      filename: 'bad.zip', worldName: 'bad-world',
    });

    await assert.rejects(
      () => worldService.importWorld(serverId, serverDir, req),
      e => e.statusCode === 400 && e.code === 'ARCHIVE_CORRUPTED'
    );
  });

  test('409 WORLD_ALREADY_EXISTS when target name is taken', async () => {
    const { serverId, serverDir } = await makeServer();
    await makeWorld(serverDir, 'existing');

    const zip = await buildZip([{ entryPath: 'level.dat', content: 'fake' }]);
    const req = buildImportReq(zip, { worldName: 'existing' });

    await assert.rejects(
      () => worldService.importWorld(serverId, serverDir, req),
      e => e.statusCode === 409 && e.code === 'WORLD_ALREADY_EXISTS'
    );
  });

  test('409 SERVER_RUNNING when server is running', async () => {
    const { serverId, serverDir } = await makeServer();
    serverModel.updateStatus(serverId, 'running', 99999);
    const zip = await buildZip([{ entryPath: 'level.dat', content: 'fake' }]);
    const req = buildImportReq(zip, { worldName: 'blocked' });

    try {
      await assert.rejects(
        () => worldService.importWorld(serverId, serverDir, req),
        e => e.statusCode === 409 && e.code === 'SERVER_RUNNING'
      );
    } finally {
      serverModel.updateStatus(serverId, 'stopped', null);
    }
  });

  test('400 MISSING_FILE when multipart has no "world" file field', async () => {
    const { serverId, serverDir } = await makeServer();
    const boundary = 'NoFileBoundary';
    const body = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\nsome-world\r\n--${boundary}--\r\n`
    );
    const req = Readable.from([body]);
    req.headers = {
      'content-type':   `multipart/form-data; boundary=${boundary}`,
      'content-length': String(body.length),
    };

    await assert.rejects(
      () => worldService.importWorld(serverId, serverDir, req),
      e => e.statusCode === 400 && e.code === 'MISSING_FILE'
    );
  });

  test('no tmp files remain on disk after a failed import', async () => {
    const { serverId, serverDir } = await makeServer();
    const req = buildImportReq(Buffer.from('NOT A ZIP'), {
      filename: 'bad.zip', worldName: 'cleanup-check',
    });

    await worldService.importWorld(serverId, serverDir, req).catch(() => {});

    const entries = await fsp.readdir(serverDir);
    const tmp = entries.filter(e => e.startsWith('.tmp-upload-') || e.startsWith('.tmp-import-'));
    assert.equal(tmp.length, 0, 'no tmp files must remain after failed import');
  });

  test('no tmp files remain on disk after a successful import', async () => {
    const { serverId, serverDir } = await makeServer();
    const zip = await buildZip([{ entryPath: 'level.dat', content: 'fake' }]);
    const req = buildImportReq(zip, { worldName: 'clean-success' });

    await worldService.importWorld(serverId, serverDir, req);

    const entries = await fsp.readdir(serverDir);
    const tmp = entries.filter(e => e.startsWith('.tmp-upload-') || e.startsWith('.tmp-import-'));
    assert.equal(tmp.length, 0, 'no tmp files must remain after successful import');
  });
});

// ─── F: exportWorld ───────────────────────────────────────────────────────────

describe('exportWorld', () => {
  test('streams zip with correct Content-Type and Content-Disposition headers', async () => {
    const { serverDir } = await makeServer();
    await makeWorld(serverDir, 'export-me', ['level.dat']);

    const res = new FakeRes();
    await worldService.exportWorld(serverDir, 'export-me', res);

    assert.equal(res.headers['Content-Type'], 'application/zip');
    assert.ok(res.headers['Content-Disposition'].includes('export-me'));
    assert.ok(res.headers['Content-Disposition'].includes('.zip'));
    assert.ok(res.headers['Content-Disposition'].includes('attachment'));
  });

  test('zip is valid and contains world files', async () => {
    const { serverDir } = await makeServer();
    await makeWorld(serverDir, 'ziptest', ['level.dat']);
    await fsp.writeFile(path.join(serverDir, 'ziptest', 'level.dat'), 'nbt-content');

    const res = new FakeRes();
    await worldService.exportWorld(serverDir, 'ziptest', res);

    const buf = res.getBuffer();
    assert.ok(buf.length > 0, 'zip buffer must not be empty');

    const zipDir = await unzipper.Open.buffer(buf);
    const names  = zipDir.files.map(f => f.path);
    assert.ok(names.some(n => n.includes('level.dat')), 'level.dat must be in zip');
  });

  test('world directory is the root entry in the zip (files under worldName/)', async () => {
    const { serverDir } = await makeServer();
    await makeWorld(serverDir, 'rootcheck', ['level.dat']);

    const res = new FakeRes();
    await worldService.exportWorld(serverDir, 'rootcheck', res);

    const zipDir = await unzipper.Open.buffer(res.getBuffer());
    const nonRoot = zipDir.files.filter(f => !f.path.startsWith('rootcheck/') && f.path !== 'rootcheck/');
    assert.equal(nonRoot.length, 0, 'all entries must be under rootcheck/');
  });

  test('excludes .lock files from the exported zip', async () => {
    const { serverDir } = await makeServer();
    await makeWorld(serverDir, 'locktest', ['level.dat']);
    await fsp.writeFile(path.join(serverDir, 'locktest', 'session.lock'), 'lock');
    await fsp.writeFile(path.join(serverDir, 'locktest', 'uid.dat'),      'uid');

    const res = new FakeRes();
    await worldService.exportWorld(serverDir, 'locktest', res);

    const zipDir = await unzipper.Open.buffer(res.getBuffer());
    const names  = zipDir.files.map(f => f.path);
    assert.ok(!names.some(n => n.endsWith('.lock')), '.lock files must be excluded');
    assert.ok(names.some(n => n.includes('uid.dat')),  'non-lock files must be present');
  });

  test('404 WORLD_NOT_FOUND for non-existent world', async () => {
    const { serverDir } = await makeServer();
    await assert.rejects(
      () => worldService.exportWorld(serverDir, 'ghost', new FakeRes()),
      e => e.statusCode === 404 && e.code === 'WORLD_NOT_FOUND'
    );
  });

  test('400 INVALID_WORLD_NAME for path traversal', async () => {
    const { serverDir } = await makeServer();
    await assert.rejects(
      () => worldService.exportWorld(serverDir, '../escape', new FakeRes()),
      e => e.statusCode === 400 && e.code === 'INVALID_WORLD_NAME'
    );
  });

  test('400 SYMLINK_FORBIDDEN for symlinked world', async () => {
    const { serverDir } = await makeServer();
    const real = path.join(TEST_ROOT, `real-exp-${uuidv4()}`);
    await fsp.mkdir(real, { recursive: true });
    await fsp.writeFile(path.join(real, 'level.dat'), 'fake');
    try {
      await fsp.symlink(real, path.join(serverDir, 'sym-exp'));
    } catch { return; }

    await assert.rejects(
      () => worldService.exportWorld(serverDir, 'sym-exp', new FakeRes()),
      e => e.statusCode === 400 && e.code === 'SYMLINK_FORBIDDEN'
    );
  });

  test('export is allowed while server is stopped (no server-running check)', async () => {
    // exportWorld intentionally has no SERVER_RUNNING guard — export is read-only
    const { serverId, serverDir } = await makeServer();
    await makeWorld(serverDir, 'readonly');
    // Server is already stopped (default), just confirm export succeeds
    const res = new FakeRes();
    await assert.doesNotReject(
      () => worldService.exportWorld(serverDir, 'readonly', res)
    );
    assert.ok(res.getBuffer().length > 0);
  });
});
