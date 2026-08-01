import { Router } from 'express';
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { validateBody } from '../../middleware/validate.middleware.js';
import { createClassMasterSchema, updateClassMasterSchema } from './class-master.schemas.js';
import {
  getClassMasters,
  postClassMaster,
  patchClassMaster,
  removeClassMaster,
} from './class-master.controller.js';

const r = Router();

r.use(tenantMiddleware, requireAuth);

r.get('/', getClassMasters);
r.post('/', validateBody(createClassMasterSchema), postClassMaster);
r.patch('/:id', validateBody(updateClassMasterSchema), patchClassMaster);
r.delete('/:id', removeClassMaster);

export default r;
