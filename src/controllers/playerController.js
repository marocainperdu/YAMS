'use strict';

const fsp  = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const nbt  = require('prismarine-nbt');
const serverModel      = require('../models/serverModel');
const { readLevelName } = require('../services/worldService');
const { notFound, badRequest } = require('../utils/errors');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readUsercache(serverPath) {
  try {
    const raw = await fsp.readFile(path.join(serverPath, 'usercache.json'), 'utf8');
    return new Map(
      JSON.parse(raw)
        .map(e => [e.uuid?.toLowerCase(), e.name])
        .filter(([u, n]) => u && n)
    );
  } catch { return new Map(); }
}

function extractFields(v) {
  const pos = v.Pos?.value?.value ?? [];
  const rot = v.Rotation?.value?.value ?? [];
  const inv = (v.Inventory?.value?.value ?? []).map(slot => ({
    slot:  slot.Slot?.value  ?? null,
    id:    slot.id?.value    ?? null,
    count: slot.Count?.value ?? null,
  }));

  const dim = v.Dimension;
  let dimension = null;
  if (dim?.type === 'string') {
    dimension = dim.value;
  } else if (dim?.type === 'int') {
    dimension = dim.value === -1 ? 'minecraft:the_nether'
              : dim.value === 1  ? 'minecraft:the_end'
              :                    'minecraft:overworld';
  }

  return {
    gamemode:          v.playerGameType?.value ?? 0,
    health:            v.Health?.value         ?? 20,
    food:              v.FoodLevel?.value       ?? 20,
    xpLevel:           v.XpLevel?.value         ?? 0,
    xpProgress:        v.XpP?.value             ?? 0,
    score:             v.Score?.value           ?? 0,
    pos:    { x: pos[0] ?? null, y: pos[1] ?? null, z: pos[2] ?? null },
    rotation: { yaw: rot[0] ?? null, pitch: rot[1] ?? null },
    dimension,
    dimensionEditable: dim?.type === 'string',
    spawnX: v.SpawnX?.value ?? null,
    spawnY: v.SpawnY?.value ?? null,
    spawnZ: v.SpawnZ?.value ?? null,
    inventory: inv,
  };
}

async function _getPlayerdataDir(server) {
  const levelName = await readLevelName(server.path);
  return path.join(server.path, levelName, 'playerdata');
}

function _requireServer(id) {
  const server = serverModel.findById(id);
  if (!server) throw notFound('Server not found');
  return server;
}

async function list(req, res, next) {
  try {
    const server = _requireServer(req.params.id);
    const dir = await _getPlayerdataDir(server);

    let entries;
    try { entries = await fsp.readdir(dir); }
    catch { return res.json({ data: [] }); }

    const uuids = entries
      .filter(f => /^[0-9a-f-]{36}\.dat$/i.test(f))
      .map(f => f.slice(0, -4));

    const cache = await readUsercache(server.path);
    res.json({
      data: uuids.map(uuid => ({
        uuid,
        name: cache.get(uuid.toLowerCase()) ?? null,
      })),
    });
  } catch (err) { next(err); }
}

async function getData(req, res, next) {
  try {
    const server = _requireServer(req.params.id);
    if (!UUID_RE.test(req.params.uuid)) return next(badRequest('Invalid UUID'));

    const dir = await _getPlayerdataDir(server);
    const datPath = path.join(dir, `${req.params.uuid}.dat`);

    let buffer;
    try { buffer = await fsp.readFile(datPath); }
    catch { return next(notFound('Player data not found')); }

    const { parsed } = await nbt.parse(buffer);
    res.json({ data: extractFields(parsed.value) });
  } catch (err) { next(err); }
}

async function updateData(req, res, next) {
  try {
    const server = _requireServer(req.params.id);
    if (!UUID_RE.test(req.params.uuid)) return next(badRequest('Invalid UUID'));

    const b = req.body;

    // Validate before touching disk
    if (b.gamemode !== undefined && ![0, 1, 2, 3].includes(b.gamemode))
      return next(badRequest('gamemode must be 0, 1, 2, or 3'));
    if (b.health !== undefined && (typeof b.health !== 'number' || b.health < 0 || b.health > 20))
      return next(badRequest('health must be a number between 0 and 20'));
    if (b.food !== undefined && (!Number.isInteger(b.food) || b.food < 0 || b.food > 20))
      return next(badRequest('food must be an integer between 0 and 20'));
    if (b.xpLevel !== undefined && (!Number.isInteger(b.xpLevel) || b.xpLevel < 0))
      return next(badRequest('xpLevel must be an integer >= 0'));
    if (b.xpProgress !== undefined && (typeof b.xpProgress !== 'number' || b.xpProgress < 0 || b.xpProgress > 1))
      return next(badRequest('xpProgress must be a number between 0 and 1'));
    const spawnDefined = [b.spawnX, b.spawnY, b.spawnZ].filter(v => v !== undefined);
    if (spawnDefined.length > 0 && spawnDefined.length < 3)
      return next(badRequest('spawnX, spawnY, and spawnZ must all be provided together'));

    const dir = await _getPlayerdataDir(server);
    const datPath = path.join(dir, `${req.params.uuid}.dat`);

    let buffer;
    try { buffer = await fsp.readFile(datPath); }
    catch { return next(notFound('Player data not found')); }

    const { parsed, type } = await nbt.parse(buffer);
    const v = parsed.value;

    if (b.gamemode   !== undefined) v.playerGameType.value = b.gamemode;
    if (b.health     !== undefined) v.Health.value         = b.health;
    if (b.food       !== undefined) v.FoodLevel.value      = b.food;
    if (b.xpLevel    !== undefined) v.XpLevel.value        = b.xpLevel;
    if (b.xpProgress !== undefined) v.XpP.value            = b.xpProgress;
    if (b.score      !== undefined) v.Score.value          = b.score;

    if (b.pos) {
      if (b.pos.x !== undefined) v.Pos.value.value[0] = b.pos.x;
      if (b.pos.y !== undefined) v.Pos.value.value[1] = b.pos.y;
      if (b.pos.z !== undefined) v.Pos.value.value[2] = b.pos.z;
    }

    if (b.dimension !== undefined && v.Dimension?.type === 'string')
      v.Dimension.value = b.dimension;

    if (b.spawnX !== undefined) {
      if (v.SpawnX) {
        v.SpawnX.value = b.spawnX;
        v.SpawnY.value = b.spawnY;
        v.SpawnZ.value = b.spawnZ;
      } else {
        v.SpawnX = { type: 'int', value: b.spawnX };
        v.SpawnY = { type: 'int', value: b.spawnY };
        v.SpawnZ = { type: 'int', value: b.spawnZ };
      }
    }

    const rawBuf = nbt.writeUncompressed(parsed, type);
    const gzipped = zlib.gzipSync(rawBuf);
    const tmpPath = datPath + '.tmp';
    await fsp.writeFile(tmpPath, gzipped);
    await fsp.rename(tmpPath, datPath);

    res.json({ data: extractFields(v) });
  } catch (err) { next(err); }
}

module.exports = { list, getData, updateData };
