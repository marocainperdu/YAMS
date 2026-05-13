'use strict';

const { Router } = require('express');
const controller = require('../controllers/backupController');
const { authMiddleware, requireServerPermission } = require('../middleware/auth');
const { heavyOpLimiter } = require('../middleware/rateLimits');

// mergeParams: true lets us access :id from the parent router (/servers/:id)
const router = Router({ mergeParams: true });

router.use(authMiddleware);

//                                                          permission
router.get('/',                   requireServerPermission('read'),    controller.list);
router.post('/',                  heavyOpLimiter, requireServerPermission('control'), controller.create);
router.get('/:backupId/download', requireServerPermission('read'),    controller.download);
router.delete('/:backupId',       requireServerPermission('control'), controller.remove);
router.post('/:backupId/restore', requireServerPermission('control'), controller.restore);

module.exports = router;
