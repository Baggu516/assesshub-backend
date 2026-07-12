import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  authenticatePlatformLogin,
  createOrganizationWithOptionalAdmin,
  getOrganizationById,
  getOrganizationStats,
  listOrganizations as listOrganizationsService,
  patchOrganizationById,
} from './platform.service.js';

export const loginPlatform = asyncHandler(async (req, res) => {
  const session = await authenticatePlatformLogin(req.body.email, req.body.password);
  res.json(session);
});

export const pingPlatform = asyncHandler(async (_req, res) => {
  res.json({ ok: true });
});

export const getPlatformStats = asyncHandler(async (_req, res) => {
  res.json(await getOrganizationStats());
});

export const createOrganization = asyncHandler(async (req, res) => {
  const result = await createOrganizationWithOptionalAdmin(req.body);
  res.status(201).json(result);
});

export const listOrganizations = asyncHandler(async (_req, res) => {
  res.json({ organizations: await listOrganizationsService() });
});

export const getOrganization = asyncHandler(async (req, res) => {
  res.json({ organization: await getOrganizationById(req.params.id) });
});

export const patchOrganization = asyncHandler(async (req, res) => {
  res.json({ organization: await patchOrganizationById(req.params.id, req.body) });
});
