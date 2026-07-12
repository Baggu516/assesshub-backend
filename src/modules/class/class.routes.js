import { Router } from 'express';
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { validateBody } from '../../middleware/validate.middleware.js';
import { createClassSchema, updateClassSchema } from './class.schemas.js';
import {
  getClasses,
  getOneClass,
  postClass,
  patchClass,
  removeClass,
  getClassOptions,
} from './class.controller.js';

const r = Router();

r.use(tenantMiddleware, requireAuth);

r.get('/options', getClassOptions);
r.get('/', getClasses);
r.post('/', validateBody(createClassSchema), postClass);
r.get('/:id', getOneClass);
r.patch('/:id', validateBody(updateClassSchema), patchClass);
r.delete('/:id', removeClass);

export default r;
