import { Router } from 'express';
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { validateBody } from '../../middleware/validate.middleware.js';
import { createAcademicYearSchema, updateAcademicYearSchema } from './academic-year.schemas.js';
import {
  getAcademicYears,
  getOneAcademicYear,
  postAcademicYear,
  patchAcademicYear,
  removeAcademicYear,
} from './academic-year.controller.js';

const r = Router();

r.use(tenantMiddleware, requireAuth);

r.get('/', getAcademicYears);
r.post('/', validateBody(createAcademicYearSchema), postAcademicYear);
r.get('/:id', getOneAcademicYear);
r.patch('/:id', validateBody(updateAcademicYearSchema), patchAcademicYear);
r.delete('/:id', removeAcademicYear);

export default r;
