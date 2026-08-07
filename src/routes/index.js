import { Router } from 'express';
import mongoose from 'mongoose';
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
import classRoutes from '../modules/class/class.routes.js';
import academicYearRoutes from '../modules/academic-year/academic-year.routes.js';
import classMasterRoutes from '../modules/class-master/class-master.routes.js';
import promotionRoutes from '../modules/promotion/promotion.routes.js';

const r = Router();

const READY_STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

r.get('/health', async (_req, res) => {
  const readyState = mongoose.connection.readyState;
  const dbConnected = readyState === 1;
  let pingOk = false;
  let dbName = null;

  if (dbConnected) {
    try {
      await mongoose.connection.db.admin().ping();
      pingOk = true;
      dbName = mongoose.connection.db.databaseName;
    } catch {
      pingOk = false;
    }
  }

  const ok = dbConnected && pingOk;
  res.status(ok ? 200 : 503).json({
    ok,
    service: 'assesshub-api',
    mongodb: {
      connected: dbConnected,
      ping: pingOk,
      readyState: READY_STATES[readyState] ?? String(readyState),
      dbName,
    },
  });
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
r.use('/classes', classRoutes);
r.use('/academic-years', academicYearRoutes);
r.use('/class-masters', classMasterRoutes);
r.use('/promotions', promotionRoutes);
r.use('/platform', platformRoutes);

export default r;
