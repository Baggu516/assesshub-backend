import { Router } from 'express';
import { z } from 'zod';
import {
  getUsers,
  getSubordinates,
  postSubordinate,
  postMember,
  patchUser,
  postInvite,
} from './user.controller.js';
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { PERMISSION_KEYS } from '../../constants/permissions.js';
import {
  createSubordinateSchema,
  createMemberSchema,
  updateUserSchema,
  inviteUserSchema,
} from './user.schemas.js';
import { validateBody, validateQuery } from '../../middleware/validate.middleware.js';

const listQuery = z.object({
  search: z.string().optional(),
  page: z.coerce.number().min(1).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
});

const r = Router();

r.use(tenantMiddleware, requireAuth);

r.get(
  '/',
  validateQuery(listQuery),
  requirePermission(PERMISSION_KEYS.USER_CREATE, PERMISSION_KEYS.ASSESSMENT_CREATE),
  getUsers
);
r.get('/subordinates-tree', requirePermission(PERMISSION_KEYS.SUBORDINATE_CREATE), getSubordinates);
r.post(
  '/subordinates',
  validateBody(createSubordinateSchema),
  requirePermission(PERMISSION_KEYS.SUBORDINATE_CREATE),
  postSubordinate
);
r.post(
  '/members',
  validateBody(createMemberSchema),
  requirePermission(PERMISSION_KEYS.USER_CREATE),
  postMember
);
r.patch('/:id', validateBody(updateUserSchema), patchUser);
r.post('/invite', validateBody(inviteUserSchema), requirePermission(PERMISSION_KEYS.USER_CREATE), postInvite);

export default r;
