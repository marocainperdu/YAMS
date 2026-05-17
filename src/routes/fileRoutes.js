'use strict';

const { Router } = require('express');
const controller = require('../controllers/fileController');
const { authMiddleware, requireServerPermission } = require('../middleware/auth');

// mergeParams: true is REQUIRED — without it req.params.id is undefined
// because :id is defined in the parent app.use('/servers/:id/files', ...)
const router = Router({ mergeParams: true });

router.use(authMiddleware);

//                                                          permission
router.get('/',          requireServerPermission('read'),    controller.list);         // GET    /servers/:id/files?path=
router.get('/download',  requireServerPermission('read'),    controller.download);     // GET    /servers/:id/files/download?path=
router.get('/content',   requireServerPermission('read'),    controller.readContent);  // GET    /servers/:id/files/content?path=
router.put('/content',   requireServerPermission('control'), controller.writeContent); // PUT    /servers/:id/files/content
router.post('/upload',   requireServerPermission('control'), controller.upload);       // POST   /servers/:id/files/upload?path=&overwrite=
router.post('/mkdir',    requireServerPermission('control'), controller.mkdir);        // POST   /servers/:id/files/mkdir
router.put('/rename',    requireServerPermission('control'), controller.rename);       // PUT    /servers/:id/files/rename
router.delete('/',       requireServerPermission('control'), controller.remove);       // DELETE /servers/:id/files

module.exports = router;
