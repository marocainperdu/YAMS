'use strict';

const { Router } = require('express');
const controller = require('../controllers/worldController');
const { authMiddleware, requireServerPermission } = require('../middleware/auth');
const { heavyOpLimiter } = require('../middleware/rateLimits');

// mergeParams: true exposes :id from the parent /servers/:id mount
const router = Router({ mergeParams: true });

// Auth guard applied to every world route.
// When YAMS_AUTH_ENABLED is not 'true' both middlewares are pass-through no-ops.
router.use(authMiddleware);

//                                                         permission
router.get('/',             requireServerPermission('read'),    controller.list);        // GET    /servers/:id/worlds
router.get('/:name/export', requireServerPermission('read'),    controller.exportWorld); // GET    /servers/:id/worlds/:name/export
router.get('/:name',        requireServerPermission('read'),    controller.getOne);      // GET    /servers/:id/worlds/:name
router.post('/active',      requireServerPermission('control'), controller.setActive);   // POST   /servers/:id/worlds/active
router.post('/import',      heavyOpLimiter, requireServerPermission('control'), controller.importWorld); // POST   /servers/:id/worlds/import
router.delete('/:name',     requireServerPermission('control'), controller.remove);      // DELETE /servers/:id/worlds/:name

module.exports = router;
