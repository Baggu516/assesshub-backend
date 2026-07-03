import { Router } from 'express';
import { getDashboard, getActivity } from './reports.controller.js';
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';
import { requireAuth } from '../../middleware/auth.middleware.js';

const r = Router();

r.use(tenantMiddleware, requireAuth);

r.get('/dashboard', getDashboard);
r.get('/activity', getActivity);

export default r;
