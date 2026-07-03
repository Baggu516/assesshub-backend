import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  listStudentGroups,
  getStudentGroup,
  createStudentGroup,
  updateStudentGroup,
  deleteStudentGroup,
} from './student-group.service.js';

export const getStudentGroups = asyncHandler(async (req, res) => {
  const result = await listStudentGroups(req.tenantModels, req.user, req.tenant.orgId);
  res.json(result);
});

export const getOneStudentGroup = asyncHandler(async (req, res) => {
  const group = await getStudentGroup(req.tenantModels, req.user, req.tenant.orgId, req.params.id);
  res.json({ group });
});

export const postStudentGroup = asyncHandler(async (req, res) => {
  const group = await createStudentGroup(req.tenantModels, req.user, req.tenant.orgId, req.body);
  res.status(201).json({ group });
});

export const patchStudentGroup = asyncHandler(async (req, res) => {
  const group = await updateStudentGroup(
    req.tenantModels,
    req.user,
    req.tenant.orgId,
    req.params.id,
    req.body
  );
  res.json({ group });
});

export const removeStudentGroup = asyncHandler(async (req, res) => {
  const result = await deleteStudentGroup(req.tenantModels, req.user, req.tenant.orgId, req.params.id);
  res.json(result);
});
