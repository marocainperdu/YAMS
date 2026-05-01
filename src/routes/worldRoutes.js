'use strict';

const { Router }   = require('express');
const controller   = require('../controllers/worldController');

// mergeParams: true exposes :id from the parent /servers/:id mount
const router = Router({ mergeParams: true });

router.get('/',             controller.list);        // GET    /servers/:id/worlds
router.get('/:name/export', controller.exportWorld); // GET    /servers/:id/worlds/:name/export
router.get('/:name',        controller.getOne);      // GET    /servers/:id/worlds/:name
router.post('/active',      controller.setActive);   // POST   /servers/:id/worlds/active
router.post('/import',      controller.importWorld); // POST   /servers/:id/worlds/import
router.delete('/:name',     controller.remove);      // DELETE /servers/:id/worlds/:name

module.exports = router;
