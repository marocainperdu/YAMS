'use strict';

const { Router } = require('express');
const { authMiddleware, requireServerPermission } = require('../middleware/auth');
const scheduleController = require('../controllers/scheduleController');

// mergeParams: true so req.params.id (server id) is accessible inside this router
const router = Router({ mergeParams: true });

router.use(authMiddleware);

router.get('/',              requireServerPermission('read'),    scheduleController.list);
router.post('/',             requireServerPermission('control'), scheduleController.create);
router.patch('/:scheduleId', requireServerPermission('control'), scheduleController.update);
router.delete('/:scheduleId',requireServerPermission('control'), scheduleController.remove);

module.exports = router;
