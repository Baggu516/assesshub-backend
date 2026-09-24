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
  proctorCaptureSchema,
  listAssessmentQuery,
  listMyAssignmentsQuery,
  listResultsQuery,
} from './assessment.schemas.js';
import {
  postAssessment,
  getAssessments,
  getOneAssessment,
  patchAssessment,
  postPublishAssessment,
  postUnpublishAssessment,
  deleteOneAssessment,
  postAssignAssessment,
  getAssessmentAssignees,
  getMyAssignments,
  getOneAssignment,
  postSubmitAssignment,
  postFullscreenExit,
  postProctorCapture,
  getProctorCaptures,
  getProctorCaptureImage,
  getResults,
  getAssignmentSummary,
  postReleaseResults,
  postReattempt,
  deleteResult,
  postHideResult,
} from './assessment.controller.js';

const r = Router();

r.use(tenantMiddleware, requireAuth);

r.get(
  '/assignees',
  requirePermission(PERMISSION_KEYS.ASSESSMENT_CREATE, PERMISSION_KEYS.ONLINE_EXAM_CREATE),
  getAssessmentAssignees
);
r.get(
  '/assignments/my',
  requirePermission(PERMISSION_KEYS.ASSESSMENT_VIEW, PERMISSION_KEYS.ONLINE_EXAM_VIEW),
  validateQuery(listMyAssignmentsQuery),
  getMyAssignments
);
r.get(
  '/assignments/:assignmentId',
  requirePermission(PERMISSION_KEYS.ASSESSMENT_VIEW, PERMISSION_KEYS.ONLINE_EXAM_VIEW),
  getOneAssignment
);
r.post(
  '/assignments/:assignmentId/captures',
  requirePermission(PERMISSION_KEYS.ONLINE_EXAM_SUBMIT, PERMISSION_KEYS.ASSESSMENT_SUBMIT),
  validateBody(proctorCaptureSchema),
  postProctorCapture
);
r.get(
  '/assignments/:assignmentId/captures',
  requirePermission(PERMISSION_KEYS.ONLINE_EXAM_CREATE, PERMISSION_KEYS.ASSESSMENT_CREATE),
  getProctorCaptures
);
r.get(
  '/assignments/:assignmentId/captures/:captureId',
  requirePermission(PERMISSION_KEYS.ONLINE_EXAM_CREATE, PERMISSION_KEYS.ASSESSMENT_CREATE),
  getProctorCaptureImage
);
r.post(
  '/assignments/:assignmentId/fullscreen-exit',
  requirePermission(PERMISSION_KEYS.ONLINE_EXAM_SUBMIT, PERMISSION_KEYS.ASSESSMENT_SUBMIT),
  postFullscreenExit
);
r.post(
  '/assignments/:assignmentId/submit',
  requirePermission(PERMISSION_KEYS.ASSESSMENT_SUBMIT, PERMISSION_KEYS.ONLINE_EXAM_SUBMIT),
  validateBody(submitAssessmentSchema),
  postSubmitAssignment
);

r.get(
  '/',
  validateQuery(listAssessmentQuery),
  requirePermission(PERMISSION_KEYS.ASSESSMENT_CREATE, PERMISSION_KEYS.ONLINE_EXAM_CREATE),
  getAssessments
);
r.post(
  '/',
  validateBody(createAssessmentSchema),
  requirePermission(PERMISSION_KEYS.ASSESSMENT_CREATE, PERMISSION_KEYS.ONLINE_EXAM_CREATE),
  postAssessment
);
r.get('/:id', requirePermission(PERMISSION_KEYS.ASSESSMENT_CREATE, PERMISSION_KEYS.ONLINE_EXAM_CREATE), getOneAssessment);
r.patch(
  '/:id',
  validateBody(updateAssessmentSchema),
  requirePermission(PERMISSION_KEYS.ASSESSMENT_CREATE, PERMISSION_KEYS.ONLINE_EXAM_CREATE),
  patchAssessment
);
r.delete('/:id', requirePermission(PERMISSION_KEYS.ASSESSMENT_CREATE, PERMISSION_KEYS.ONLINE_EXAM_CREATE), deleteOneAssessment);
r.post('/:id/publish', requirePermission(PERMISSION_KEYS.ASSESSMENT_CREATE, PERMISSION_KEYS.ONLINE_EXAM_CREATE), postPublishAssessment);
r.post('/:id/unpublish', requirePermission(PERMISSION_KEYS.ASSESSMENT_CREATE, PERMISSION_KEYS.ONLINE_EXAM_CREATE), postUnpublishAssessment);
r.post(
  '/:id/assign',
  validateBody(assignAssessmentSchema),
  requirePermission(PERMISSION_KEYS.ASSESSMENT_CREATE, PERMISSION_KEYS.ONLINE_EXAM_CREATE),
  postAssignAssessment
);
r.get(
  '/:id/results',
  validateQuery(listResultsQuery),
  requirePermission(PERMISSION_KEYS.ASSESSMENT_CREATE, PERMISSION_KEYS.ONLINE_EXAM_CREATE),
  getResults
);
r.get(
  '/:id/assignment-summary',
  validateQuery(listResultsQuery),
  requirePermission(PERMISSION_KEYS.ASSESSMENT_CREATE, PERMISSION_KEYS.ONLINE_EXAM_CREATE),
  getAssignmentSummary
);
r.post(
  '/:id/release-results',
  requirePermission(PERMISSION_KEYS.ASSESSMENT_CREATE, PERMISSION_KEYS.ONLINE_EXAM_CREATE),
  postReleaseResults
);
r.post(
  '/:id/results/:assignmentId/reattempt',
  requirePermission(PERMISSION_KEYS.ASSESSMENT_CREATE, PERMISSION_KEYS.ONLINE_EXAM_CREATE),
  postReattempt
);
r.post(
  '/:id/results/:assignmentId/hide',
  requirePermission(PERMISSION_KEYS.ASSESSMENT_CREATE, PERMISSION_KEYS.ONLINE_EXAM_CREATE),
  postHideResult
);
r.delete(
  '/:id/results/:assignmentId',
  requirePermission(PERMISSION_KEYS.ASSESSMENT_CREATE, PERMISSION_KEYS.ONLINE_EXAM_CREATE),
  deleteResult
);

export default r;
