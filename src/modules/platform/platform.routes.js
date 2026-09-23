import { Router } from 'express';
import { platformAuthMiddleware } from '../../middleware/platform.middleware.js';
import { validateBody } from '../../middleware/validate.middleware.js';
import { authLimiter } from '../../middleware/rateLimit.middleware.js';
import {
  loginPlatform,
  pingPlatform,
  getPlatformStats,
  createOrganization,
  listOrganizations,
  getOrganization,
  patchOrganization,
  normalizeOrgFormBody,
} from './platform.controller.js';
import {
  createPlatformUser,
  deletePlatformUser,
  getPlatformUser,
  listPlatformUsers,
  patchPlatformUser,
} from './platformUsers.controller.js';
import {
  loginPlatformSchema,
  createOrganizationSchema,
  patchOrganizationSchema,
  createPlatformUserSchema,
  patchPlatformUserSchema,
} from './platform.schemas.js';
import { logoUpload } from './logo.upload.js';

const r = Router();

function parseOrgMultipart(req, _res, next) {
  req.body = normalizeOrgFormBody(req.body || {});
  next();
}

r.post('/login', authLimiter, validateBody(loginPlatformSchema), loginPlatform);

r.use(platformAuthMiddleware);

r.get('/ping', pingPlatform);
r.get('/stats', getPlatformStats);
r.get('/users', listPlatformUsers);
r.post('/users', validateBody(createPlatformUserSchema), createPlatformUser);
r.get('/users/:id', getPlatformUser);
r.patch('/users/:id', validateBody(patchPlatformUserSchema), patchPlatformUser);
r.delete('/users/:id', deletePlatformUser);

r.post(
  '/organizations',
  logoUpload.single('logo'),
  parseOrgMultipart,
  validateBody(createOrganizationSchema),
  createOrganization
);
r.get('/organizations', listOrganizations);
r.get('/organizations/:id', getOrganization);
r.patch(
  '/organizations/:id',
  logoUpload.single('logo'),
  parseOrgMultipart,
  validateBody(patchOrganizationSchema),
  patchOrganization
);

export default r;
