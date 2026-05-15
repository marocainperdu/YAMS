'use strict';

const { Router } = require('express');
const { authMiddleware, requireServerPermission } = require('../middleware/auth');
const ctrl = require('../controllers/modsController');

const router = Router({ mergeParams: true });
router.use(authMiddleware);

// Static routes must come before :filename / :projectId param routes
router.get( '/search',              requireServerPermission('read'),    ctrl.searchMods);
router.post('/scan',                requireServerPermission('read'),    ctrl.scan);
router.post('/prune',               requireServerPermission('control'), ctrl.prune);
router.post('/install',             requireServerPermission('control'), ctrl.install);
router.post('/upload',              requireServerPermission('control'), ctrl.upload);
router.get( '/:projectId/versions', requireServerPermission('read'),    ctrl.getVersions);
router.get( '/',                    requireServerPermission('read'),    ctrl.list);
router.patch('/:filename',          requireServerPermission('control'), ctrl.toggle);
router.delete('/:filename',         requireServerPermission('control'), ctrl.remove);

module.exports = router;
