'use strict';

const { Router } = require('express');
const { authMiddleware, requireServerPermission } = require('../middleware/auth');
const ctrl = require('../controllers/playerController');

const router = Router({ mergeParams: true });
router.use(authMiddleware);

router.get('/',             requireServerPermission('read'),    ctrl.list);
router.get('/:uuid/data',   requireServerPermission('read'),    ctrl.getData);
router.patch('/:uuid/data', requireServerPermission('control'), ctrl.updateData);

module.exports = router;
