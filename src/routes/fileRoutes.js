'use strict';

const { Router } = require('express');
const controller  = require('../controllers/fileController');

// mergeParams: true is REQUIRED — without it req.params.id is undefined
// because :id is defined in the parent app.use('/servers/:id/files', ...)
const router = Router({ mergeParams: true });

router.get('/',         controller.list);      // GET    /servers/:id/files?path=
router.get('/download', controller.download);  // GET    /servers/:id/files/download?path=
router.post('/upload',  controller.upload);    // POST   /servers/:id/files/upload?path=&overwrite=
router.post('/mkdir',   controller.mkdir);     // POST   /servers/:id/files/mkdir
router.put('/rename',   controller.rename);    // PUT    /servers/:id/files/rename
router.delete('/',      controller.remove);    // DELETE /servers/:id/files

module.exports = router;
