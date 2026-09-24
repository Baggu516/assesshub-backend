import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  authenticatePlatformLogin,
  createOrganizationWithOptionalAdmin,
  getOrganizationById,
  getOrganizationStats,
  listOrganizations as listOrganizationsService,
  patchOrganizationById,
} from './platform.service.js';
import { uploadClientLogo } from './logo.service.js';

/** Coerce multipart text fields into typed body for Zod. */
export function normalizeOrgFormBody(raw = {}) {
  const body = { ...raw };

  if (typeof body.isActive === 'string') {
    body.isActive = body.isActive === 'true' || body.isActive === '1';
  }
  if (typeof body.clearLogo === 'string') {
    body.clearLogo = body.clearLogo === 'true' || body.clearLogo === '1';
  }
  if (typeof body.features === 'string' && body.features.trim()) {
    try {
      body.features = JSON.parse(body.features);
    } catch {
      /* leave as-is; zod will fail */
    }
  }
  if (body.tagline === '') body.tagline = undefined;
  if (body.adminEmail === '') body.adminEmail = undefined;
  if (body.adminPassword === '') body.adminPassword = undefined;
  if (body.firstName === '') body.firstName = undefined;
  if (body.lastName === '') body.lastName = undefined;

  return body;
}

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
  const result = await createOrganizationWithOptionalAdmin(req.body, req.file);
  res.status(201).json(result);
});

export const listOrganizations = asyncHandler(async (_req, res) => {
  res.json({ organizations: await listOrganizationsService() });
});

export const getOrganization = asyncHandler(async (req, res) => {
  res.json({ organization: await getOrganizationById(req.params.id) });
});

export const patchOrganization = asyncHandler(async (req, res) => {
  res.json({ organization: await patchOrganizationById(req.params.id, req.body, req.file) });
});

export const uploadOrganizationLogo = asyncHandler(async (req, res) => {
  const logo = await uploadClientLogo(req.file, req.body?.subdomain);
  res.status(201).json(logo);
});
