'use strict';

const { Router } = require('express');
const { authMiddleware, requireServerPermission } = require('../middleware/auth');
const webhookController = require('../controllers/webhookController');

const router = Router({ mergeParams: true });

router.use(authMiddleware);

router.get('/',                    requireServerPermission('read'),    webhookController.list);
router.post('/',                   requireServerPermission('control'), webhookController.create);
router.patch('/:webhookId',        requireServerPermission('control'), webhookController.update);
router.delete('/:webhookId',       requireServerPermission('control'), webhookController.remove);
router.post('/:webhookId/test',    requireServerPermission('control'), webhookController.test);

module.exports = router;
