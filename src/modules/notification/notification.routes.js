import { Router } from 'express';
import { listNotifications, markRead } from './notification.controller.js';
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';
import { requireAuth } from '../../middleware/auth.middleware.js';

const r = Router();

r.use(tenantMiddleware, requireAuth);
r.get('/', listNotifications);
r.post('/:id/read', markRead);

export default r;
