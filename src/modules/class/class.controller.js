import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  listClasses,
  getClass,
  createClass,
  updateClass,
  deleteClass,
  listClassMemberOptions,
} from './class.service.js';

export const getClasses = asyncHandler(async (req, res) => {
  const result = await listClasses(req.tenantModels, req.user, req.tenant.orgId);
  res.json(result);
});

export const getOneClass = asyncHandler(async (req, res) => {
  const klass = await getClass(req.tenantModels, req.user, req.tenant.orgId, req.params.id);
  res.json({ class: klass });
});

export const postClass = asyncHandler(async (req, res) => {
  const klass = await createClass(req.tenantModels, req.user, req.tenant.orgId, req.body);
  res.status(201).json({ class: klass });
});

export const patchClass = asyncHandler(async (req, res) => {
  const klass = await updateClass(
    req.tenantModels,
    req.user,
    req.tenant.orgId,
    req.params.id,
    req.body
  );
  res.json({ class: klass });
});

export const removeClass = asyncHandler(async (req, res) => {
  const result = await deleteClass(req.tenantModels, req.user, req.tenant.orgId, req.params.id);
  res.json(result);
});

export const getClassOptions = asyncHandler(async (req, res) => {
  const result = await listClassMemberOptions(req.tenantModels, req.user, req.tenant.orgId);
  res.json(result);
});
