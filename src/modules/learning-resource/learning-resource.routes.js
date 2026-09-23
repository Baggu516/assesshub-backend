import { Router } from 'express';
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { getResources, postResource, patchResource, removeResource, getResourceFile } from './learning-resource.controller.js';
import { resourceUpload } from './resource.upload.js';

const r = Router();

r.use(tenantMiddleware, requireAuth);

r.get('/', getResources);
r.post('/', resourceUpload.single('file'), postResource);
r.get('/:id/file', getResourceFile);
r.patch('/:id', resourceUpload.single('file'), patchResource);
r.delete('/:id', removeResource);

export default r;
