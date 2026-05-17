'use strict';

const { Router }             = require('express');
const { authMiddleware, requireAdmin } = require('../middleware/auth');
const userController         = require('../controllers/userController');

const userRouter = Router();
userRouter.post('/',          authMiddleware, requireAdmin, userController.createUser);  // POST   /users
userRouter.get('/',           authMiddleware, requireAdmin, userController.listUsers);   // GET    /users
userRouter.patch('/:id/role', authMiddleware, requireAdmin, userController.updateRole);  // PATCH  /users/:id/role
userRouter.delete('/:id',     authMiddleware, requireAdmin, userController.removeUser);  // DELETE /users/:id

const permissionRouter = Router();
permissionRouter.post('/', authMiddleware, requireAdmin, userController.assignPermissions); // POST /permissions

module.exports = { userRouter, permissionRouter };
