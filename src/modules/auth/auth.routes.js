import { Router } from 'express';
import {
  registerOrg,
  loginUser,
  refresh,
  logoutUser,
  me,
  acceptInviteHandler,
} from './auth.controller.js';
import { registerOrgSchema, loginSchema, refreshSchema, acceptInviteSchema } from './auth.schemas.js';
import { validateBody } from '../../middleware/validate.middleware.js';
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { authLimiter } from '../../middleware/rateLimit.middleware.js';

const r = Router();

r.post('/register-org', authLimiter, validateBody(registerOrgSchema), registerOrg);
r.post('/login', authLimiter, tenantMiddleware, validateBody(loginSchema), loginUser);
r.post('/refresh', authLimiter, validateBody(refreshSchema), refresh);
r.post('/logout', authLimiter, validateBody(refreshSchema), logoutUser);
r.post(
  '/accept-invite',
  authLimiter,
  tenantMiddleware,
  validateBody(acceptInviteSchema),
  acceptInviteHandler
);
r.get('/me', tenantMiddleware, requireAuth, me);

export default r;
