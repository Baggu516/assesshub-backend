import { Router } from 'express';
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { validateBody } from '../../middleware/validate.middleware.js';
import { PERMISSION_KEYS } from '../../constants/permissions.js';
import { createStudentGroupSchema, updateStudentGroupSchema } from './student-group.schemas.js';
import {
  getStudentGroups,
  getOneStudentGroup,
  postStudentGroup,
  patchStudentGroup,
  removeStudentGroup,
} from './student-group.controller.js';

const r = Router();

r.use(tenantMiddleware, requireAuth, requirePermission(PERMISSION_KEYS.USER_CREATE));

r.get('/', getStudentGroups);
r.post('/', validateBody(createStudentGroupSchema), postStudentGroup);
r.get('/:id', getOneStudentGroup);
r.patch('/:id', validateBody(updateStudentGroupSchema), patchStudentGroup);
r.delete('/:id', removeStudentGroup);

export default r;
