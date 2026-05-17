'use strict';

const { Router } = require('express');
const { authMiddleware, requireServerPermission } = require('../middleware/auth');
const { AppError } = require('../utils/errors');
const modrinth    = require('../utils/modrinthClient');
const curseforge  = require('../utils/curseforgeClient');

const router = Router();
router.use(authMiddleware);

// Wrap plain errors from API clients into operational AppErrors so the global
// error handler surfaces the real message instead of a generic 500.
function toOperational(err) {
  if (err.isOperational) return err;
  const status = err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 502;
  return new AppError(err.message, status);
}

// GET /api/modpacks/platforms
// Returns which platforms are available (always modrinth; curseforge only if key set)
router.get('/platforms', requireServerPermission('read'), (_req, res) => {
  const platforms = ['modrinth'];
  if (curseforge.isEnabled()) platforms.push('curseforge');
  res.json({ data: platforms });
});

// GET /api/modpacks/search?platform=modrinth&query=...&limit=20&offset=0
router.get('/search', requireServerPermission('read'), async (req, res, next) => {
  try {
    const { platform = 'modrinth', query = '', limit = 20, offset = 0 } = req.query;

    if (platform === 'curseforge') {
      if (!curseforge.isEnabled()) {
        return res.status(400).json({ error: 'CurseForge is not configured (CURSEFORGE_API_KEY not set)' });
      }
      const result = await curseforge.searchModpacks(query, Number(limit), Number(offset));
      return res.json({ data: result.data, pagination: result.pagination });
    }

    // Default: Modrinth
    const result = await modrinth.searchModpacks(query, Number(limit), Number(offset));
    res.json({ data: result.hits, total: result.total_hits, offset: result.offset, limit: result.limit });
  } catch (err) {
    next(toOperational(err));
  }
});

// GET /api/modpacks/:platform/:projectId/versions
router.get('/:platform/:projectId/versions', requireServerPermission('read'), async (req, res, next) => {
  try {
    const { platform, projectId } = req.params;

    if (platform === 'curseforge') {
      if (!curseforge.isEnabled()) {
        return res.status(400).json({ error: 'CurseForge is not configured (CURSEFORGE_API_KEY not set)' });
      }
      const versions = await curseforge.getPackVersions(Number(projectId));
      return res.json({ data: versions });
    }

    const versions = await modrinth.getProjectVersions(projectId);
    res.json({ data: versions });
  } catch (err) {
    next(toOperational(err));
  }
});

module.exports = router;
