'use strict';

const { Router }                  = require('express');
const controller                  = require('../controllers/backupController');
const { authMiddleware }          = require('../middleware/authMiddleware');
const { requireServerPermission } = require('../middleware/permissionMiddleware');

// mergeParams: true lets us access :id from the parent router (/servers/:id)
const router = Router({ mergeParams: true });

// H6 — all backup routes require authentication + per-server permission
router.get('/',                   authMiddleware, requireServerPermission('read'),    controller.list);
router.post('/',                  authMiddleware, requireServerPermission('control'), controller.create);
router.get('/:backupId/download', authMiddleware, requireServerPermission('read'),    controller.download);
router.delete('/:backupId',       authMiddleware, requireServerPermission('control'), controller.remove);
router.post('/:backupId/restore', authMiddleware, requireServerPermission('control'), controller.restore);

module.exports = router;
