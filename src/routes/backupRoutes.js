'use strict';

const { Router } = require('express');
const controller = require('../controllers/backupController');

// mergeParams: true lets us access :id from the parent router (/servers/:id)
const router = Router({ mergeParams: true });

router.get('/',                   controller.list);
router.post('/',                  controller.create);
router.get('/:backupId/download', controller.download);
router.delete('/:backupId',       controller.remove);
router.post('/:backupId/restore', controller.restore);

module.exports = router;
