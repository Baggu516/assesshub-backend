import { Router } from 'express';
import { z } from 'zod';
import { getCurrentTenant, patchOrgSettings } from './tenant.controller.js';
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { PERMISSION_KEYS } from '../../constants/permissions.js';
import { validateBody } from '../../middleware/validate.middleware.js';

const sidebarLabelsSchema = z
  .object({
    dashboard: z.string().trim().max(48).optional(),
    subordinates: z.string().trim().max(48).optional(),
    users: z.string().trim().max(48).optional(),
    usersMember: z.string().trim().max(48).optional(),
    profile: z.string().trim().max(48).optional(),
    organization: z.string().trim().max(48).optional(),
    settingsNav: z.string().trim().max(48).optional(),
    assessments: z.string().trim().max(48).optional(),
    myAssessments: z.string().trim().max(48).optional(),
    groupStudents: z.string().trim().max(48).optional(),
    classes: z.string().trim().max(48).optional(),
    knowledgeBase: z.string().trim().max(48).optional(),
  })
  .optional();

const settingsSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  settings: z
    .object({
      timezone: z.string().optional(),
      sidebarLabels: sidebarLabelsSchema,
    })
    .optional(),
});

const r = Router();

r.get('/current', tenantMiddleware, requireAuth, getCurrentTenant);
r.patch(
  '/settings',
  tenantMiddleware,
  requireAuth,
  validateBody(settingsSchema),
  requirePermission(PERMISSION_KEYS.SETTINGS_MANAGE),
  patchOrgSettings
);

export default r;
