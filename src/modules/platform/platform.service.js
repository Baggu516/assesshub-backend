import mongoose from 'mongoose';
import { getTenantModels } from '../../db/tenantModels.js';
import { Organization } from '../../models/Organization.js';
import { PlatformUser } from '../../models/PlatformUser.js';
import { AppError } from '../../utils/errors.js';
import { comparePassword } from '../../utils/hash.js';
import {
  platformTokenExpiresIn,
  signPlatformToken,
} from '../../utils/jwt.js';
import { issueTenantSession, provisionOrganizationAdmin } from '../auth/auth.service.js';
import {
  isPlatformPasswordLoginConfigured,
  validatePlatformCredentials,
} from './platformAuth.util.js';

export function serializeOrganization(o) {
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

export function issuePlatformAccessToken() {
  return {
    accessToken: signPlatformToken(),
    expiresIn: platformTokenExpiresIn(),
  };
}

export async function authenticatePlatformLogin(emailRaw, password) {
  const email = String(emailRaw || '').trim().toLowerCase();

  const dbUser = await PlatformUser.findOne({ email });
  if (dbUser) {
    if (!dbUser.isActive) {
      throw new AppError('This platform account is disabled', 403);
    }
    const ok = await comparePassword(password, dbUser.passwordHash);
    if (!ok) throw new AppError('Invalid email or password', 401);
    return issuePlatformAccessToken();
  }

  if (isPlatformPasswordLoginConfigured()) {
    if (!validatePlatformCredentials(emailRaw, password)) {
      throw new AppError('Invalid email or password', 401);
    }
    return issuePlatformAccessToken();
  }

  throw new AppError(
    'Platform email login is not available. Configure PLATFORM_ADMIN_EMAIL in .env, sign in with X-Platform-Key and create a platform user, or ask an administrator.',
    503
  );
}

export async function getOrganizationStats() {
  const [totalOrganizations, activeOrganizations] = await Promise.all([
    Organization.countDocuments(),
    Organization.countDocuments({ isActive: true }),
  ]);
  return {
    totalOrganizations,
    activeOrganizations,
    inactiveOrganizations: Math.max(0, totalOrganizations - activeOrganizations),
  };
}

export async function createOrganizationWithOptionalAdmin(body) {
  const sub = body.subdomain.toLowerCase();
  const exists = await Organization.findOne({ subdomain: sub });
  if (exists) throw new AppError('Subdomain already taken', 409);

  const org = await Organization.create({
    name: body.name,
    subdomain: sub,
    isActive: body.isActive !== false,
  });

  const wantsAdmin = !!(body.adminEmail && body.adminPassword);

  try {
    if (wantsAdmin) {
      const populated = await provisionOrganizationAdmin(org, {
        adminEmail: body.adminEmail,
        adminPassword: body.adminPassword,
        firstName: body.firstName,
        lastName: body.lastName,
      });
      const models = getTenantModels(org.subdomain);
      const session = await issueTenantSession(models, populated, org.subdomain);
      const fresh = await Organization.findById(org._id).lean();
      return {
        organization: serializeOrganization(fresh),
        adminProvisioned: true,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresIn: session.expiresIn,
        user: session.user,
      };
    }
  } catch (e) {
    await Organization.deleteOne({ _id: org._id });
    throw e;
  }

  const fresh = await Organization.findById(org._id).lean();
  return {
    organization: serializeOrganization(fresh),
    adminProvisioned: false,
  };
}

export async function listOrganizations() {
  const rows = await Organization.find().sort({ createdAt: -1 }).lean();
  return rows.map((o) => serializeOrganization(o));
}

export async function getOrganizationById(id) {
  if (!mongoose.isValidObjectId(id)) throw new AppError('Invalid organization id', 400);
  const org = await Organization.findById(id).lean();
  if (!org) throw new AppError('Organization not found', 404);
  return serializeOrganization(org);
}

export async function patchOrganizationById(id, body) {
  if (!mongoose.isValidObjectId(id)) throw new AppError('Invalid organization id', 400);
  const org = await Organization.findById(id);
  if (!org) throw new AppError('Organization not found', 404);

  if (body.name !== undefined) org.name = body.name;
  if (body.isActive !== undefined) org.isActive = body.isActive;
  await org.save();

  return serializeOrganization(org.toObject());
}
