import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  createAssessment,
  listAssessments,
  getAssessment,
  updateAssessment,
  publishAssessment,
  assignAssessment,
  listAssessmentAssignees,
  listMyAssignments,
  getAssignment,
  submitAssignment,
  getAssessmentResults,
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
  const result = await listMyAssignments(req.tenantModels, req.user, req.tenant.orgId);
  res.json(result);
});

export const getOneAssignment = asyncHandler(async (req, res) => {
  const result = await getAssignment(
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
    req.params.id
  );
  res.json(result);
});
