'use strict';

const { Router }             = require('express');
const { authMiddleware }     = require('../middleware/authMiddleware');
const { requireAdmin }       = require('../middleware/permissionMiddleware');
const userController         = require('../controllers/userController');

const userRouter = Router();
userRouter.post('/', authMiddleware, requireAdmin, userController.createUser);  // POST /users
userRouter.get('/',  authMiddleware, requireAdmin, userController.listUsers);   // GET  /users

const permissionRouter = Router();
permissionRouter.post('/', authMiddleware, requireAdmin, userController.assignPermissions); // POST /permissions

module.exports = { userRouter, permissionRouter };
