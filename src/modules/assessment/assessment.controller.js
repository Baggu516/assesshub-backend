import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  createAssessment,
  listAssessments,
  getAssessment,
  updateAssessment,
  publishAssessment,
  unpublishAssessment,
  deleteAssessment,
  assignAssessment,
  listAssessmentAssignees,
  listMyAssignments,
  getAssignment,
  submitAssignment,
  recordFullscreenExit,
  saveProctorCapture,
  listProctorCaptures,
  readProctorCapture,
  getAssessmentResults,
  getAssessmentAssignmentSummary,
  releaseAssessmentResults,
  reattemptAssignment,
  setAssignmentResultsHidden,
  deleteAssignmentResult,
} from './assessment.service.js';

export const postAssessment = asyncHandler(async (req, res) => {
  const assessment = await createAssessment(
    req.tenantModels,
    req.user,
    req.tenant.orgId,
    req.body,
    req.ip
  );
  res.status(201).json({ assessment });
});

export const getAssessments = asyncHandler(async (req, res) => {
  const result = await listAssessments(req.tenantModels, req.user, req.tenant.orgId, req.query);
  res.json(result);
});

export const getOneAssessment = asyncHandler(async (req, res) => {
  const assessment = await getAssessment(req.tenantModels, req.user, req.tenant.orgId, req.params.id);
  res.json({ assessment });
});

export const patchAssessment = asyncHandler(async (req, res) => {
  const assessment = await updateAssessment(
    req.tenantModels,
    req.user,
    req.tenant.orgId,
    req.params.id,
    req.body
  );
  res.json({ assessment });
});

export const postPublishAssessment = asyncHandler(async (req, res) => {
  const assessment = await publishAssessment(
    req.tenantModels,
    req.user,
    req.tenant.orgId,
    req.params.id
  );
  res.json({ assessment });
});

export const postUnpublishAssessment = asyncHandler(async (req, res) => {
  const assessment = await unpublishAssessment(
    req.tenantModels,
    req.user,
    req.tenant.orgId,
    req.params.id
  );
  res.json({ assessment });
});

export const deleteOneAssessment = asyncHandler(async (req, res) => {
  const result = await deleteAssessment(
    req.tenantModels,
    req.user,
    req.tenant.orgId,
    req.params.id
  );
  res.json(result);
});

export const postAssignAssessment = asyncHandler(async (req, res) => {
  const result = await assignAssessment(
    req.tenantModels,
    req.user,
    req.tenant.orgId,
    req.params.id,
    req.body
  );
  res.json(result);
});

export const getAssessmentAssignees = asyncHandler(async (req, res) => {
  const assignees = await listAssessmentAssignees(req.tenantModels, req.user, req.tenant.orgId);
  res.json({ assignees });
});

export const getMyAssignments = asyncHandler(async (req, res) => {
  const result = await listMyAssignments(req.tenantModels, req.user, req.tenant.orgId, req.query);
  res.json(result);
});

export const getOneAssignment = asyncHandler(async (req, res) => {
  const preview = req.query.preview === '1' || req.query.preview === 'true';
  const result = await getAssignment(
    req.tenantModels,
    req.user,
    req.tenant.orgId,
    req.params.assignmentId,
    { preview }
  );
  res.json(result);
});

export const postProctorCapture = asyncHandler(async (req, res) => {
  const result = await saveProctorCapture(
    req.tenantModels,
    req.user,
    req.tenant.orgId,
    req.params.assignmentId,
    req.body
  );
  res.status(result.saved ? 201 : 200).json(result);
});

export const getProctorCaptures = asyncHandler(async (req, res) => {
  const result = await listProctorCaptures(
    req.tenantModels,
    req.user,
    req.tenant.orgId,
    req.params.assignmentId
  );
  res.json(result);
});

export const getProctorCaptureImage = asyncHandler(async (req, res) => {
  const { buffer } = await readProctorCapture(
    req.tenantModels,
    req.user,
    req.tenant.orgId,
    req.params.assignmentId,
    req.params.captureId
  );
  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', 'private, max-age=300');
  res.send(buffer);
});

export const postFullscreenExit = asyncHandler(async (req, res) => {
  const result = await recordFullscreenExit(
    req.tenantModels,
    req.user,
    req.tenant.orgId,
    req.params.assignmentId
  );
  res.json(result);
});

export const postSubmitAssignment = asyncHandler(async (req, res) => {
  const result = await submitAssignment(
    req.tenantModels,
    req.user,
    req.tenant.orgId,
    req.params.assignmentId,
    req.body
  );
  res.json(result);
});

export const getResults = asyncHandler(async (req, res) => {
  const result = await getAssessmentResults(
    req.tenantModels,
    req.user,
    req.tenant.orgId,
    req.params.id,
    req.query
  );
  res.json(result);
});

export const getAssignmentSummary = asyncHandler(async (req, res) => {
  const result = await getAssessmentAssignmentSummary(
    req.tenantModels,
    req.user,
    req.tenant.orgId,
    req.params.id,
    req.query
  );
  res.json(result);
});

export const postReleaseResults = asyncHandler(async (req, res) => {
  const result = await releaseAssessmentResults(
    req.tenantModels,
    req.user,
    req.tenant.orgId,
    req.params.id,
    process.env.FRONTEND_URL
  );
  res.json(result);
});

export const postReattempt = asyncHandler(async (req, res) => {
  const result = await reattemptAssignment(
    req.tenantModels,
    req.user,
    req.tenant.orgId,
    req.params.id,
    req.params.assignmentId
  );
  res.json(result);
});

export const postHideResult = asyncHandler(async (req, res) => {
  const result = await setAssignmentResultsHidden(
    req.tenantModels,
    req.user,
    req.tenant.orgId,
    req.params.id,
    req.params.assignmentId,
    req.body?.hidden
  );
  res.json(result);
});

export const deleteResult = asyncHandler(async (req, res) => {
  const result = await deleteAssignmentResult(
    req.tenantModels,
    req.user,
    req.tenant.orgId,
    req.params.id,
    req.params.assignmentId
  );
  res.json(result);
});
