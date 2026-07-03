import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { getTenantModels } from '../../db/tenantModels.js';
import { Organization } from '../../models/Organization.js';
import { PlatformUser } from '../../models/PlatformUser.js';
import { env } from '../../config/env.js';
import { comparePassword } from '../../utils/hash.js';
import { issueTenantSession, provisionOrganizationAdmin } from '../auth/auth.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  isPlatformPasswordLoginConfigured,
  validatePlatformCredentials,
} from './platformAuth.util.js';

function issuePlatformSession(res) {
  const accessToken = jwt.sign({ platform: true }, env.PLATFORM_ADMIN_JWT_SECRET, {
    expiresIn: env.PLATFORM_ADMIN_TOKEN_EXPIRES_IN,
  });
  res.json({
    accessToken,
    expiresIn: env.PLATFORM_ADMIN_TOKEN_EXPIRES_IN,
  });
}

export const loginPlatform = asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = req.body.password;

  const dbUser = await PlatformUser.findOne({ email });
  if (dbUser) {
    if (!dbUser.isActive) {
      return res.status(403).json({ error: 'This platform account is disabled' });
    }
    const ok = await comparePassword(password, dbUser.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    return issuePlatformSession(res);
  }

  if (isPlatformPasswordLoginConfigured()) {
    if (validatePlatformCredentials(req.body.email, password)) {
      return issuePlatformSession(res);
    }
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  return res.status(503).json({
    error:
      'Platform email login is not available. Configure PLATFORM_ADMIN_EMAIL in .env, sign in with X-Platform-Key and create a platform user, or ask an administrator.',
  });
});

function serializeOrg(o) {
  return {
    id: o._id.toString(),
    name: o.name,
    subdomain: o.subdomain,
    isActive: o.isActive,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    settings: o.settings,
  };
}

export const pingPlatform = asyncHandler(async (_req, res) => {
  res.json({ ok: true });
});

export const getPlatformStats = asyncHandler(async (_req, res) => {
  const [totalOrganizations, activeOrganizations] = await Promise.all([
    Organization.countDocuments(),
    Organization.countDocuments({ isActive: true }),
  ]);
  const inactiveOrganizations = Math.max(0, totalOrganizations - activeOrganizations);
  res.json({
    totalOrganizations,
    activeOrganizations,
    inactiveOrganizations,
  });
});

export const createOrganization = asyncHandler(async (req, res) => {
  const sub = req.body.subdomain.toLowerCase();
  const exists = await Organization.findOne({ subdomain: sub });
  if (exists) {
    return res.status(409).json({ error: 'Subdomain already taken' });
  }

  const org = await Organization.create({
    name: req.body.name,
    subdomain: sub,
    isActive: req.body.isActive !== false,
  });

  const wantsAdmin = !!(req.body.adminEmail && req.body.adminPassword);

  try {
    if (wantsAdmin) {
      const populated = await provisionOrganizationAdmin(org, {
        adminEmail: req.body.adminEmail,
        adminPassword: req.body.adminPassword,
        firstName: req.body.firstName,
        lastName: req.body.lastName,
      });
      const models = getTenantModels(org.subdomain);
      const session = await issueTenantSession(models, populated, org.subdomain);
      const fresh = await Organization.findById(org._id).lean();
      return res.status(201).json({
        organization: serializeOrg(fresh),
        adminProvisioned: true,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresIn: session.expiresIn,
        user: session.user,
      });
    }
  } catch (e) {
    await Organization.deleteOne({ _id: org._id });
    throw e;
  }

  const fresh = await Organization.findById(org._id).lean();
  res.status(201).json({
    organization: serializeOrg(fresh),
    adminProvisioned: false,
  });
});

export const listOrganizations = asyncHandler(async (_req, res) => {
  const rows = await Organization.find().sort({ createdAt: -1 }).lean();
  res.json({
    organizations: rows.map((o) => serializeOrg(o)),
  });
});

export const getOrganization = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid organization id' });
  }
  const org = await Organization.findById(id).lean();
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  res.json({ organization: serializeOrg(org) });
});

export const patchOrganization = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid organization id' });
  }
  const org = await Organization.findById(id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });

  if (req.body.name !== undefined) org.name = req.body.name;
  if (req.body.isActive !== undefined) org.isActive = req.body.isActive;
  await org.save();

  res.json({ organization: serializeOrg(org.toObject()) });
});
