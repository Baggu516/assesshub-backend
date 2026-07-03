import { Router } from 'express';
import { getPermissions } from './permission.controller.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';

const r = Router();

/** Catalog is needed when assigning permissions; any authenticated org user may read. */
r.get('/', tenantMiddleware, requireAuth, getPermissions);

export default r;
