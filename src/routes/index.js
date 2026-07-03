import { Router } from 'express';
import authRoutes from '../modules/auth/auth.routes.js';
import userRoutes from '../modules/user/user.routes.js';
import permissionRoutes from '../modules/permission/permission.routes.js';
import tenantRoutes from '../modules/tenant/tenant.routes.js';
import reportsRoutes from '../modules/reports/reports.routes.js';
import notificationRoutes from '../modules/notification/notification.routes.js';
import platformRoutes from '../modules/platform/platform.routes.js';
import aiRoutes from '../modules/ai/ai.routes.js';
import kbRoutes from '../modules/kb/kb.routes.js';
import assessmentRoutes from '../modules/assessment/assessment.routes.js';
import studentGroupRoutes from '../modules/student-group/student-group.routes.js';

const r = Router();

r.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'assesshub-api' });
});

r.use('/auth', authRoutes);
r.use('/users', userRoutes);
r.use('/permissions', permissionRoutes);
r.use('/tenant', tenantRoutes);
r.use('/reports', reportsRoutes);
r.use('/notifications', notificationRoutes);
r.use('/ai', aiRoutes);
r.use('/kb', kbRoutes);
r.use('/assessments', assessmentRoutes);
r.use('/student-groups', studentGroupRoutes);
r.use('/platform', platformRoutes);

export default r;
