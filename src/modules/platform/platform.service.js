import mongoose from 'mongoose';
import {
  databaseNameFromSubdomain,
  forgetTenantDatabaseName,
  getTenantModels,
  rememberTenantDatabaseName,
} from '../../db/tenantModels.js';
import { Organization } from '../../models/Organization.js';
import { PlatformUser } from '../../models/PlatformUser.js';
import { AppError } from '../../utils/errors.js';
import { resolveStoredLogoUrl } from '../../utils/s3.js';
import { comparePassword } from '../../utils/hash.js';
import {
  platformTokenExpiresIn,
  signPlatformToken,
} from '../../utils/jwt.js';
import { isReservedSubdomain } from '../../utils/reservedSubdomains.js';
import { issueTenantSession, provisionOrganizationAdmin } from '../auth/auth.service.js';
import {
  isPlatformPasswordLoginConfigured,
  validatePlatformCredentials,
} from './platformAuth.util.js';
import {
  normalizeOrgFeatures,
  planFromFeatures,
} from '../../middleware/plan.middleware.js';
import {
  assertClientLogoRef,
  assignClientLogo,
  clearClientLogo,
  replaceClientLogo,
  uploadClientLogo,
} from './logo.service.js';

function featureFlags(raw, fallback = {}) {
  return {
    aiDashboard: raw?.aiDashboard === true,
    aiAssessmentCreate: raw?.aiAssessmentCreate === true,
    worksheets: raw?.worksheets === true,
    assessments: raw?.assessments === true,
    onlineExams:
      raw && Object.prototype.hasOwnProperty.call(raw, 'onlineExams')
        ? raw.onlineExams === true
        : fallback.onlineExams === true,
  };
}

function resolveIncomingFeatures(body, existingFeatures = null) {
  if (body.features) {
    return featureFlags(body.features, existingFeatures || {});
  }
  if (body.plan !== undefined) {
    const current = existingFeatures || {};
    return featureFlags(
      {
        ...current,
        aiDashboard: body.plan === 'ai_dashboard',
      },
      current
    );
  }
  return null;
}

export function serializeOrganization(o, { poc } = {}) {
  const features = normalizeOrgFeatures(o);
  const payload = {
    id: o._id.toString(),
    name: o.name,
    subdomain: o.subdomain,
    dbName: o.dbName || null,
    isActive: o.isActive,
    logoUrl: resolveStoredLogoUrl(o),
    tagline: o.tagline || null,
    plan: planFromFeatures(features),
    features,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    settings: o.settings,
  };
  if (poc !== undefined) payload.poc = poc;
  return payload;
}

/** First tenant admin as point of contact (read-only for platform console). */
export async function resolveOrganizationPoc(org) {
  try {
    const { User } = await getTenantModels(org.subdomain);
    const admin = await User.findOne({
      orgId: org._id,
      hierarchyRole: 'admin',
      isActive: true,
    })
      .sort({ createdAt: 1 })
      .select('firstName lastName email')
      .lean();
    if (!admin) return null;
    const name = [admin.firstName, admin.lastName].filter(Boolean).join(' ').trim();
    return {
      name: name || null,
      email: admin.email,
      firstName: admin.firstName || '',
      lastName: admin.lastName || '',
    };
  } catch {
    return null;
  }
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
    Organization.countDocuments({ subdomain: { $ne: 'master' } }),
    Organization.countDocuments({ subdomain: { $ne: 'master' }, isActive: true }),
  ]);
  return {
    totalOrganizations,
    activeOrganizations,
    inactiveOrganizations: Math.max(0, totalOrganizations - activeOrganizations),
  };
}

export async function createOrganizationWithOptionalAdmin(body, logoFile) {
  const sub = body.subdomain.toLowerCase();
  if (isReservedSubdomain(sub)) {
    throw new AppError('This subdomain is reserved', 400);
  }
  const exists = await Organization.findOne({ subdomain: sub });
  if (exists) throw new AppError('Subdomain already taken', 409);

  const features = resolveIncomingFeatures(body) || {
    aiDashboard: false,
    aiAssessmentCreate: false,
    worksheets: false,
    assessments: false,
    onlineExams: false,
  };

  let logoFields = {};
  if (body.logoUrl && body.logoStoragePath) {
    assertClientLogoRef(body.logoUrl, body.logoStoragePath);
    logoFields = { logoUrl: body.logoUrl, logoStoragePath: body.logoStoragePath };
  } else if (logoFile) {
    logoFields = await uploadClientLogo(logoFile, sub);
  }

  const dbName = databaseNameFromSubdomain(sub);
  const dbTaken = await Organization.findOne({ dbName }).select('_id').lean();
  if (dbTaken) throw new AppError('Database name already in use', 409);

  const org = await Organization.create({
    name: body.name,
    subdomain: sub,
    dbName,
    isActive: body.isActive !== false,
    features,
    plan: planFromFeatures(features),
    tagline: body.tagline || undefined,
    ...logoFields,
  });
  rememberTenantDatabaseName(sub, dbName);

  const wantsAdmin = !!(body.adminEmail && body.adminPassword);

  try {
    if (wantsAdmin) {
      const populated = await provisionOrganizationAdmin(org, {
        adminEmail: body.adminEmail,
        adminPassword: body.adminPassword,
        firstName: body.firstName,
        lastName: body.lastName,
      });
      const models = await getTenantModels(org.subdomain);
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
    if (org.logoStoragePath) {
      try {
        await clearClientLogo(org);
      } catch {
        /* ignore */
      }
    }
    forgetTenantDatabaseName(sub);
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
  const rows = await Organization.find({ subdomain: { $ne: 'master' } })
    .sort({ createdAt: -1 })
    .lean();
  return rows.map((o) => serializeOrganization(o));
}

export async function getOrganizationById(id) {
  if (!mongoose.isValidObjectId(id)) throw new AppError('Invalid organization id', 400);
  const org = await Organization.findById(id).lean();
  if (!org) throw new AppError('Organization not found', 404);
  const poc = await resolveOrganizationPoc(org);
  return serializeOrganization(org, { poc });
}

export async function patchOrganizationById(id, body, logoFile) {
  if (!mongoose.isValidObjectId(id)) throw new AppError('Invalid organization id', 400);
  const org = await Organization.findById(id);
  if (!org) throw new AppError('Organization not found', 404);

  if (body.name !== undefined) org.name = body.name;
  if (body.isActive !== undefined) org.isActive = body.isActive;
  if (body.tagline !== undefined) {
    org.tagline = body.tagline === null || body.tagline === '' ? undefined : body.tagline;
  }

  const nextFeatures = resolveIncomingFeatures(body, normalizeOrgFeatures(org));
  if (nextFeatures) {
    org.features = nextFeatures;
    org.plan = planFromFeatures(nextFeatures);
  }

  if (body.logoUrl && body.logoStoragePath) {
    await assignClientLogo(org, body.logoUrl, body.logoStoragePath);
  } else if (body.clearLogo === true && !logoFile) {
    await clearClientLogo(org);
  } else if (logoFile) {
    await replaceClientLogo(org, logoFile);
  }

  await org.save();

  return serializeOrganization(org.toObject());
}
