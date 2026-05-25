'use strict';

const CURRENT    = require('../../package.json').version;
const IMAGE      = 'marocainperdu/yams';
const CACHE_TTL  = 60 * 60 * 1000; // 1 hour

let _cached  = null;
let _cachedAt = 0;

function semverGt(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return false;
}

async function fetchLatest() {
  if (_cached && Date.now() - _cachedAt < CACHE_TTL) return _cached;

  const url = `https://hub.docker.com/v2/repositories/${IMAGE}/tags?page_size=25&ordering=-last_updated`;
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`Docker Hub ${res.status}`);

  const { results = [] } = await res.json();
  const semverRe = /^\d+\.\d+\.\d+$/;
  const tags = results.map(t => t.name).filter(n => semverRe.test(n));

  tags.sort((a, b) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if (pa[i] !== pb[i]) return pb[i] - pa[i];
    }
    return 0;
  });

  _cached  = tags[0] ?? null;
  _cachedAt = Date.now();
  return _cached;
}

async function get(_req, res, next) {
  try {
    let latest = null;
    try { latest = await fetchLatest(); } catch (err) {
      console.warn('[version] Docker Hub check failed:', err.message);
    }
    res.json({
      data: {
        current:         CURRENT,
        latest,
        updateAvailable: latest ? semverGt(latest, CURRENT) : false,
      },
    });
  } catch (err) { next(err); }
}

module.exports = { get };
