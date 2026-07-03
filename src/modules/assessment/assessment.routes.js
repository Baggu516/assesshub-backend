import { Router } from 'express';
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { validateBody, validateQuery } from '../../middleware/validate.middleware.js';
import { PERMISSION_KEYS } from '../../constants/permissions.js';
import {
  createAssessmentSchema,
  updateAssessmentSchema,
  assignAssessmentSchema,
  submitAssessmentSchema,
  listAssessmentQuery,
} from './assessment.schemas.js';
import {
  postAssessment,
  getAssessments,
  getOneAssessment,
  patchAssessment,
  postPublishAssessment,
  postAssignAssessment,
  getAssessmentAssignees,
  getMyAssignments,
  getOneAssignment,
  postSubmitAssignment,
  getResults,
} from './assessment.controller.js';

const r = Router();

r.use(tenantMiddleware, requireAuth);

r.get('/assignees', requirePermission(PERMISSION_KEYS.ASSESSMENT_CREATE), getAssessmentAssignees);
r.get(
  '/assignments/my',
  requirePermission(PERMISSION_KEYS.ASSESSMENT_VIEW),
  getMyAssignments
);
r.get(
  '/assignments/:assignmentId',
  requirePermission(PERMISSION_KEYS.ASSESSMENT_VIEW),
  getOneAssignment
);
r.post(
  '/assignments/:assignmentId/submit',
  requirePermission(PERMISSION_KEYS.ASSESSMENT_SUBMIT),
  validateBody(submitAssessmentSchema),
  postSubmitAssignment
);

r.get('/', validateQuery(listAssessmentQuery), requirePermission(PERMISSION_KEYS.ASSESSMENT_CREATE), getAssessments);
r.post(
  '/',
  validateBody(createAssessmentSchema),
  requirePermission(PERMISSION_KEYS.ASSESSMENT_CREATE),
  postAssessment
);
r.get('/:id', requirePermission(PERMISSION_KEYS.ASSESSMENT_CREATE), getOneAssessment);
r.patch(
  '/:id',
  validateBody(updateAssessmentSchema),
  requirePermission(PERMISSION_KEYS.ASSESSMENT_CREATE),
  patchAssessment
);
r.post('/:id/publish', requirePermission(PERMISSION_KEYS.ASSESSMENT_CREATE), postPublishAssessment);
r.post(
  '/:id/assign',
  validateBody(assignAssessmentSchema),
  requirePermission(PERMISSION_KEYS.ASSESSMENT_CREATE),
  postAssignAssessment
);
r.get('/:id/results', requirePermission(PERMISSION_KEYS.ASSESSMENT_CREATE), getResults);

export default r;
