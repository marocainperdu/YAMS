'use strict';

const { Router }                  = require('express');
const controller                  = require('../controllers/worldController');
const { authMiddleware }          = require('../middleware/authMiddleware');
const { requireServerPermission } = require('../middleware/permissionMiddleware');

// mergeParams: true exposes :id from the parent /servers/:id mount
const router = Router({ mergeParams: true });

// H6 — all world routes require authentication + per-server permission.
// /:name/export is registered before /:name to avoid Express routing conflict.
router.get('/',             authMiddleware, requireServerPermission('read'),    controller.list);
router.get('/:name/export', authMiddleware, requireServerPermission('read'),    controller.exportWorld);
router.get('/:name',        authMiddleware, requireServerPermission('read'),    controller.getOne);
router.post('/active',      authMiddleware, requireServerPermission('control'), controller.setActive);
router.post('/import',      authMiddleware, requireServerPermission('control'), controller.importWorld);
router.delete('/:name',     authMiddleware, requireServerPermission('control'), controller.remove);

module.exports = router;
