import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  listAcademicYears,
  getAcademicYear,
  createAcademicYear,
  updateAcademicYear,
  deleteAcademicYear,
} from './academic-year.service.js';

export const getAcademicYears = asyncHandler(async (req, res) => {
  const result = await listAcademicYears(req.tenantModels, req.user, req.tenant.orgId);
  res.json(result);
});

export const getOneAcademicYear = asyncHandler(async (req, res) => {
  const academicYear = await getAcademicYear(
    req.tenantModels,
    req.user,
    req.tenant.orgId,
    req.params.id
  );
  res.json({ academicYear });
});

export const postAcademicYear = asyncHandler(async (req, res) => {
  const academicYear = await createAcademicYear(
    req.tenantModels,
    req.user,
    req.tenant.orgId,
    req.body,
    req.ip
  );
  res.status(201).json({ academicYear });
});

export const patchAcademicYear = asyncHandler(async (req, res) => {
  const academicYear = await updateAcademicYear(
    req.tenantModels,
    req.user,
    req.tenant.orgId,
    req.params.id,
    req.body,
    req.ip
  );
  res.json({ academicYear });
});

export const removeAcademicYear = asyncHandler(async (req, res) => {
  const result = await deleteAcademicYear(
    req.tenantModels,
    req.user,
    req.tenant.orgId,
    req.params.id,
    req.ip
  );
  res.json(result);
});
