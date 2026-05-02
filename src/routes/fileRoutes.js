'use strict';

const { Router }                  = require('express');
const controller                  = require('../controllers/fileController');
const { authMiddleware }          = require('../middleware/authMiddleware');
const { requireServerPermission } = require('../middleware/permissionMiddleware');

// mergeParams: true is REQUIRED — without it req.params.id is undefined
// because :id is defined in the parent app.use('/servers/:id/files', ...)
const router = Router({ mergeParams: true });

// H6 — all file routes require authentication + per-server permission
router.get('/',         authMiddleware, requireServerPermission('read'),    controller.list);
router.get('/download', authMiddleware, requireServerPermission('read'),    controller.download);
router.post('/upload',  authMiddleware, requireServerPermission('control'), controller.upload);
router.post('/mkdir',   authMiddleware, requireServerPermission('control'), controller.mkdir);
router.put('/rename',   authMiddleware, requireServerPermission('control'), controller.rename);
router.delete('/',      authMiddleware, requireServerPermission('control'), controller.remove);

module.exports = router;
