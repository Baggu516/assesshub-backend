import { Router } from 'express';
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { PERMISSION_KEYS } from '../../constants/permissions.js';
import { getResources, postResource, patchResource, removeResource, getResourceFile } from './learning-resource.controller.js';
import { resourceUpload } from './resource.upload.js';

const r = Router();

r.use(tenantMiddleware, requireAuth);

r.get(
  '/',
  requirePermission(PERMISSION_KEYS.WORKSHEET_VIEW, PERMISSION_KEYS.WORKSHEET_MANAGE),
  getResources
);
r.post(
  '/',
  requirePermission(PERMISSION_KEYS.WORKSHEET_MANAGE),
  resourceUpload.single('file'),
  postResource
);
r.get(
  '/:id/file',
  requirePermission(PERMISSION_KEYS.WORKSHEET_VIEW, PERMISSION_KEYS.WORKSHEET_MANAGE),
  getResourceFile
);
r.patch(
  '/:id',
  requirePermission(PERMISSION_KEYS.WORKSHEET_MANAGE),
  resourceUpload.single('file'),
  patchResource
);
r.delete('/:id', requirePermission(PERMISSION_KEYS.WORKSHEET_MANAGE), removeResource);

export default r;
