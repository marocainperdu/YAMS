'use strict';

const { Router }    = require('express');
const controller    = require('../controllers/authController');

const router = Router();

router.post('/login', controller.login); // POST /auth/login

module.exports = router;
