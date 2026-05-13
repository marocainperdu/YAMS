'use strict';

/**
 * Integration tests — fileService
 *
 * Runs against a real temp filesystem. No HTTP server, no DB required.
 *
 * Run: node --test tests/file.test.js
 */

const { describe, test, before, after } = require('node:test');
const assert  = require('node:assert/strict');
const path    = require('path');
const fs      = require('fs');
const fsp     = require('fs/promises');
const os      = require('os');
const { Readable } = require('stream');
const { v4: uuidv4 } = require('uuid');

// ─── Env setup — MUST precede any module that reads env at load time ──────────

const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'yams-file-'));

process.env.YAMS_SERVERS_ROOT = TEST_ROOT;

const fileService = require('../src/services/fileService');

// ─── Cleanup ──────────────────────────────────────────────────────────────────

after(() => {
  try { fs.rmSync(TEST_ROOT, { recursive: true, force: true }); } catch {}
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function makeServerDir() {
  const serverId  = uuidv4();
  const serverDir = path.join(TEST_ROOT, serverId);
  await fsp.mkdir(serverDir, { recursive: true });
  return { serverId, serverDir };
}

/** Build a fake multipart/form-data request for uploadFile. */
function makeUploadReq(filename, content) {
  const boundary = 'YAMSTestBoundary';
  const CRLF     = '\r\n';
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}` +
      `Content-Type: application/octet-stream${CRLF}` +
      `${CRLF}`
    ),
    Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'),
    Buffer.from(`${CRLF}--${boundary}--${CRLF}`),
  ]);

  const req = new Readable({ read() {} });
  req.headers = {
    'content-type': `multipart/form-data; boundary=${boundary}`,
  };
  req.ip     = '127.0.0.1';
  req.user   = null;
  req.socket = { remoteAddress: '127.0.0.1' };
  req.push(body);
  req.push(null);
  return req;
}

/** Drain a readable stream into a Buffer. */
function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data',  c   => chunks.push(c));
    stream.on('end',   ()  => resolve(Buffer.concat(chunks)));
    stream.on('error', err => reject(err));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// listDirectory
// ─────────────────────────────────────────────────────────────────────────────

describe('listDirectory', () => {
  test('lists files and directories in server root', async () => {
    const { serverId, serverDir } = await makeServerDir();
    await fsp.writeFile(path.join(serverDir, 'server.properties'), 'data');
    await fsp.mkdir(path.join(serverDir, 'world'), { recursive: true });

    const { data, truncated } = await fileService.listDirectory(serverId, '');
    assert.equal(truncated, false);
    const names = data.map(e => e.name);
    assert.ok(names.includes('server.properties'));
    assert.ok(names.includes('world'));
  });

  test('directories come before files in the result', async () => {
    const { serverId, serverDir } = await makeServerDir();
    await fsp.writeFile(path.join(serverDir, 'aaa.txt'), '');
    await fsp.mkdir(path.join(serverDir, 'zzz'), { recursive: true });

    const { data } = await fileService.listDirectory(serverId, '');
    assert.equal(data[0].type, 'directory', 'first entry must be a directory');
  });

  test('file entries include size and modified fields', async () => {
    const { serverId, serverDir } = await makeServerDir();
    await fsp.writeFile(path.join(serverDir, 'hello.txt'), 'hello');

    const { data } = await fileService.listDirectory(serverId, '');
    const entry = data.find(e => e.name === 'hello.txt');
    assert.ok(entry);
    assert.equal(entry.type, 'file');
    assert.ok(typeof entry.size === 'number');
    assert.ok(typeof entry.modified === 'number');
  });

  test('lists a subdirectory', async () => {
    const { serverId, serverDir } = await makeServerDir();
    await fsp.mkdir(path.join(serverDir, 'plugins'), { recursive: true });
    await fsp.writeFile(path.join(serverDir, 'plugins', 'myplugin.jar'), 'fake');

    const { data } = await fileService.listDirectory(serverId, 'plugins');
    assert.ok(data.some(e => e.name === 'myplugin.jar'));
  });

  test('excludes symlinks silently', async () => {
    const { serverId, serverDir } = await makeServerDir();
    const target = path.join(TEST_ROOT, `sym-target-${uuidv4()}`);
    await fsp.writeFile(target, 'data');
    try {
      await fsp.symlink(target, path.join(serverDir, 'link.txt'));
    } catch { return; }

    const { data } = await fileService.listDirectory(serverId, '');
    assert.ok(!data.some(e => e.name === 'link.txt'), 'symlinks must be excluded');
  });

  test('404 for missing directory', async () => {
    const { serverId } = await makeServerDir();
    await assert.rejects(
      () => fileService.listDirectory(serverId, 'nonexistent'),
      e => e.statusCode === 404
    );
  });

  test('400 when path points to a file, not a directory', async () => {
    const { serverId, serverDir } = await makeServerDir();
    await fsp.writeFile(path.join(serverDir, 'file.txt'), 'x');
    await assert.rejects(
      () => fileService.listDirectory(serverId, 'file.txt'),
      e => e.statusCode === 400
    );
  });

  test('403 for path traversal attempt', async () => {
    const { serverId } = await makeServerDir();
    await assert.rejects(
      () => fileService.listDirectory(serverId, '../../etc'),
      e => e.statusCode === 403
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// downloadFile
// ─────────────────────────────────────────────────────────────────────────────

describe('downloadFile', () => {
  test('returns stream, filename, contentType, and size', async () => {
    const { serverId, serverDir } = await makeServerDir();
    await fsp.writeFile(path.join(serverDir, 'server.properties'), 'level-name=world\n');

    const result = await fileService.downloadFile(serverId, 'server.properties');
    assert.equal(result.filename, 'server.properties');
    assert.equal(result.contentType, 'text/plain');
    assert.ok(result.size > 0);
    assert.ok(result.stream);
    result.stream.destroy();
  });

  test('streams the correct file content', async () => {
    const { serverId, serverDir } = await makeServerDir();
    const content = 'hello from YAMS';
    await fsp.writeFile(path.join(serverDir, 'test.txt'), content);

    const { stream } = await fileService.downloadFile(serverId, 'test.txt');
    const buf = await streamToBuffer(stream);
    assert.equal(buf.toString(), content);
  });

  test('resolves MIME type by extension', async () => {
    const { serverId, serverDir } = await makeServerDir();
    await fsp.writeFile(path.join(serverDir, 'data.json'), '{}');

    const { contentType } = await fileService.downloadFile(serverId, 'data.json');
    assert.equal(contentType, 'application/json');
  });

  test('404 for missing file', async () => {
    const { serverId } = await makeServerDir();
    await assert.rejects(
      () => fileService.downloadFile(serverId, 'ghost.txt'),
      e => e.statusCode === 404
    );
  });

  test('400 when path is a directory', async () => {
    const { serverId, serverDir } = await makeServerDir();
    await fsp.mkdir(path.join(serverDir, 'adir'), { recursive: true });
    await assert.rejects(
      () => fileService.downloadFile(serverId, 'adir'),
      e => e.statusCode === 400
    );
  });

  test('403 for symlinked file', async () => {
    const { serverId, serverDir } = await makeServerDir();
    const target = path.join(TEST_ROOT, `dl-target-${uuidv4()}`);
    await fsp.writeFile(target, 'secret');
    try {
      await fsp.symlink(target, path.join(serverDir, 'link.txt'));
    } catch { return; }
    await assert.rejects(
      () => fileService.downloadFile(serverId, 'link.txt'),
      e => e.statusCode === 403
    );
  });

  test('403 for path traversal attempt', async () => {
    const { serverId } = await makeServerDir();
    await assert.rejects(
      () => fileService.downloadFile(serverId, '../../../etc/passwd'),
      e => e.statusCode === 403
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// uploadFile
// ─────────────────────────────────────────────────────────────────────────────

describe('uploadFile', () => {
  test('saves file to the destination directory', async () => {
    const { serverId, serverDir } = await makeServerDir();
    const req = makeUploadReq('config.txt', 'some config');
    await fileService.uploadFile(serverId, '', req, false);

    const content = await fsp.readFile(path.join(serverDir, 'config.txt'), 'utf8');
    assert.equal(content, 'some config');
  });

  test('returns the saved filename', async () => {
    const { serverId } = await makeServerDir();
    const req    = makeUploadReq('myfile.txt', 'data');
    const result = await fileService.uploadFile(serverId, '', req, false);
    assert.equal(result.name, 'myfile.txt');
  });

  test('saves into a subdirectory', async () => {
    const { serverId, serverDir } = await makeServerDir();
    await fsp.mkdir(path.join(serverDir, 'plugins'), { recursive: true });
    const req = makeUploadReq('config.yml', 'key: value');
    await fileService.uploadFile(serverId, 'plugins', req, false);

    const exists = await fsp.access(path.join(serverDir, 'plugins', 'config.yml'))
      .then(() => true).catch(() => false);
    assert.ok(exists);
  });

  test('409 CONFLICT when file exists and overwrite=false', async () => {
    const { serverId, serverDir } = await makeServerDir();
    await fsp.writeFile(path.join(serverDir, 'existing.txt'), 'old');
    const req = makeUploadReq('existing.txt', 'new');
    await assert.rejects(
      () => fileService.uploadFile(serverId, '', req, false),
      e => e.statusCode === 409
    );
  });

  test('overwrites file when overwrite=true', async () => {
    const { serverId, serverDir } = await makeServerDir();
    await fsp.writeFile(path.join(serverDir, 'overwrite.txt'), 'old content');
    const req = makeUploadReq('overwrite.txt', 'new content');
    await fileService.uploadFile(serverId, '', req, true);

    const content = await fsp.readFile(path.join(serverDir, 'overwrite.txt'), 'utf8');
    assert.equal(content, 'new content');
  });

  for (const ext of ['.jar', '.sh', '.bash', '.exe', '.bat', '.cmd', '.ps1']) {
    test(`400 FORBIDDEN_FILE_TYPE for ${ext} upload`, async () => {
      const { serverId } = await makeServerDir();
      const req = makeUploadReq(`malicious${ext}`, 'evil');
      await assert.rejects(
        () => fileService.uploadFile(serverId, '', req, false),
        e => e.statusCode === 400 && e.code === 'FORBIDDEN_FILE_TYPE'
      );
    });
  }

  test('403 for path traversal in destination directory', async () => {
    const { serverId } = await makeServerDir();
    const req = makeUploadReq('file.txt', 'data');
    await assert.rejects(
      () => fileService.uploadFile(serverId, '../../etc', req, false),
      e => e.statusCode === 403
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createFolder
// ─────────────────────────────────────────────────────────────────────────────

describe('createFolder', () => {
  test('creates a new directory', async () => {
    const { serverId, serverDir } = await makeServerDir();
    await fileService.createFolder(serverId, 'myfolder');
    const stat = await fsp.stat(path.join(serverDir, 'myfolder'));
    assert.ok(stat.isDirectory());
  });

  test('creates nested directories recursively', async () => {
    const { serverId, serverDir } = await makeServerDir();
    await fileService.createFolder(serverId, 'a/b/c');
    const stat = await fsp.stat(path.join(serverDir, 'a', 'b', 'c'));
    assert.ok(stat.isDirectory());
  });

  test('403 for path traversal attempt', async () => {
    const { serverId } = await makeServerDir();
    await assert.rejects(
      () => fileService.createFolder(serverId, '../../escape'),
      e => e.statusCode === 403
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// renameFile
// ─────────────────────────────────────────────────────────────────────────────

describe('renameFile', () => {
  test('renames a file', async () => {
    const { serverId, serverDir } = await makeServerDir();
    await fsp.writeFile(path.join(serverDir, 'old.txt'), 'data');
    await fileService.renameFile(serverId, 'old.txt', 'new.txt');

    await assert.rejects(() => fsp.access(path.join(serverDir, 'old.txt')));
    const stat = await fsp.stat(path.join(serverDir, 'new.txt'));
    assert.ok(stat.isFile());
  });

  test('renames a directory', async () => {
    const { serverId, serverDir } = await makeServerDir();
    await fsp.mkdir(path.join(serverDir, 'old-dir'), { recursive: true });
    await fileService.renameFile(serverId, 'old-dir', 'new-dir');

    const stat = await fsp.stat(path.join(serverDir, 'new-dir'));
    assert.ok(stat.isDirectory());
  });

  test('404 when source does not exist', async () => {
    const { serverId } = await makeServerDir();
    await assert.rejects(
      () => fileService.renameFile(serverId, 'ghost.txt', 'new.txt'),
      e => e.statusCode === 404
    );
  });

  test('403 when trying to rename the server root itself', async () => {
    const { serverId } = await makeServerDir();
    await assert.rejects(
      () => fileService.renameFile(serverId, '', 'escaped'),
      e => e.statusCode === 403
    );
  });

  test('403 for path traversal in source', async () => {
    const { serverId } = await makeServerDir();
    await assert.rejects(
      () => fileService.renameFile(serverId, '../../etc/passwd', 'stolen.txt'),
      e => e.statusCode === 403
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deleteFile
// ─────────────────────────────────────────────────────────────────────────────

describe('deleteFile', () => {
  test('deletes a file', async () => {
    const { serverId, serverDir } = await makeServerDir();
    await fsp.writeFile(path.join(serverDir, 'del.txt'), 'gone');
    await fileService.deleteFile(serverId, 'del.txt');

    await assert.rejects(() => fsp.access(path.join(serverDir, 'del.txt')));
  });

  test('deletes a directory recursively', async () => {
    const { serverId, serverDir } = await makeServerDir();
    await fsp.mkdir(path.join(serverDir, 'dir', 'sub'), { recursive: true });
    await fsp.writeFile(path.join(serverDir, 'dir', 'file.txt'), 'x');
    await fileService.deleteFile(serverId, 'dir');

    await assert.rejects(() => fsp.access(path.join(serverDir, 'dir')));
  });

  test('404 for missing path', async () => {
    const { serverId } = await makeServerDir();
    await assert.rejects(
      () => fileService.deleteFile(serverId, 'ghost.txt'),
      e => e.statusCode === 404
    );
  });

  test('403 when trying to delete the server root itself', async () => {
    const { serverId } = await makeServerDir();
    await assert.rejects(
      () => fileService.deleteFile(serverId, ''),
      e => e.statusCode === 403
    );
  });

  test('403 for symlinked path', async () => {
    const { serverId, serverDir } = await makeServerDir();
    const target = path.join(TEST_ROOT, `del-target-${uuidv4()}`);
    await fsp.writeFile(target, 'data');
    try {
      await fsp.symlink(target, path.join(serverDir, 'link.txt'));
    } catch { return; }
    await assert.rejects(
      () => fileService.deleteFile(serverId, 'link.txt'),
      e => e.statusCode === 403
    );
  });

  test('403 for path traversal attempt', async () => {
    const { serverId } = await makeServerDir();
    await assert.rejects(
      () => fileService.deleteFile(serverId, '../../../tmp/escape'),
      e => e.statusCode === 403
    );
  });
});
