import { Organization } from '../../models/Organization.js';
import {
  databaseNameFromSubdomain,
  forgetTenantDatabaseName,
  getTenantModels,
  rememberTenantDatabaseName,
} from '../../db/tenantModels.js';
import { ensureTenantCatalog } from '../../db/tenantCatalog.js';
import crypto from 'crypto';
import { hashPassword, comparePassword, hashToken } from '../../utils/hash.js';
import { sendPasswordResetOtp } from '../../utils/mailer.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../utils/jwt.js';
import { ALL_PERMISSION_KEYS } from '../../constants/permissions.js';
import { allocateRegistrationId, ensureUserRegistrationId } from '../../utils/registrationId.js';
import { isReservedSubdomain } from '../../utils/reservedSubdomains.js';

/** Stores refresh token and returns the same token payload shape as login. */
export async function issueTenantSession(models, populatedUser, subdomain) {
  const refreshPlain = signRefreshToken({
    sub: populatedUser._id.toString(),
    orgId: populatedUser.orgId.toString(),
    subdomain,
    type: 'refresh',
  });

  await storeRefreshToken(models, {
    userId: populatedUser._id,
    orgId: populatedUser.orgId,
    refreshPlain,
    req: null,
  });

  return buildTokenResponse(populatedUser, refreshPlain, subdomain);
}

function buildTokenResponse(user, refreshTokenPlain, subdomain) {
  const accessToken = signAccessToken({
    sub: user._id.toString(),
    orgId: user.orgId.toString(),
    subdomain,
  });

  return {
    accessToken,
    refreshToken: refreshTokenPlain,
    expiresIn: process.env.JWT_ACCESS_EXPIRES_IN,
    user: sanitizeUser(user),
  };
}

export function sanitizeUser(user) {
  return {
    id: user._id,
    email: user.email,
    registrationId: user.registrationId || null,
    firstName: user.firstName,
    lastName: user.lastName,
    hierarchyRole: user.hierarchyRole,
    parentUserId: user.parentUserId,
    permissions: user.permissions || [],
    orgId: user.orgId,
    roleId: user.roleId,
  };
}

/**
 * Seeds tenant DB catalog, admin role, and first admin user. Does not issue tokens.
 */
export async function provisionOrganizationAdmin(org, { adminEmail, adminPassword, firstName, lastName }) {
  const subdomain = org.subdomain;
  const models = await getTenantModels(subdomain);
  await ensureTenantCatalog(models, subdomain);

  const { Role, User } = models;

  const adminRole = await Role.findOneAndUpdate(
    { orgId: org._id, hierarchy: 'admin' },
    {
      $setOnInsert: {
        orgId: org._id,
        name: 'Administrator',
        hierarchy: 'admin',
        permissionKeys: ALL_PERMISSION_KEYS,
        isSystem: true,
      },
    },
    { upsert: true, new: true }
  );

  const passwordHash = await hashPassword(adminPassword);
  const registrationId = await allocateRegistrationId(User, org._id, subdomain);

  const admin = await User.create({
    orgId: org._id,
    email: adminEmail.toLowerCase(),
    registrationId,
    passwordHash,
    firstName: firstName || '',
    lastName: lastName || '',
    hierarchyRole: 'admin',
    parentUserId: null,
    roleId: adminRole._id,
    permissions: ALL_PERMISSION_KEYS,
  });

  return User.findById(admin._id).populate('roleId');
}

export async function registerOrganization(payload) {
  const sub = payload.subdomain.toLowerCase();
  if (isReservedSubdomain(sub)) {
    const err = new Error('This subdomain is reserved');
    err.status = 400;
    throw err;
  }
  const exists = await Organization.findOne({ subdomain: sub });
  if (exists) {
    const err = new Error('Subdomain already taken');
    err.status = 409;
    throw err;
  }

  const dbName = databaseNameFromSubdomain(sub);
  const dbTaken = await Organization.findOne({ dbName }).select('_id').lean();
  if (dbTaken) {
    const err = new Error('Database name already in use');
    err.status = 409;
    throw err;
  }

  const org = await Organization.create({
    name: payload.organizationName,
    subdomain: sub,
    dbName,
  });
  rememberTenantDatabaseName(sub, dbName);

  let admin;
  try {
    admin = await provisionOrganizationAdmin(org, {
      adminEmail: payload.adminEmail,
      adminPassword: payload.adminPassword,
      firstName: payload.firstName,
      lastName: payload.lastName,
    });
  } catch (err) {
    forgetTenantDatabaseName(sub);
    await Organization.deleteOne({ _id: org._id });
    throw err;
  }

  return {
    organization: {
      id: org._id,
      name: org.name,
      subdomain: org.subdomain,
      dbName: org.dbName,
    },
    user: sanitizeUser(admin),
  };
}

export async function login({ email, identifier, password, orgId }, req) {
  const models = req.tenantModels;
  const { User } = models;
  const subdomain = req.tenant.subdomain;

  const query = identifierFilter(orgId, identifier || email);
  if (!query) {
    const err = new Error('Email or registration ID is required');
    err.status = 400;
    throw err;
  }

  const user = await User.findOne(query).select('+passwordHash');

  if (!user || !user.passwordHash) {
    const err = new Error('Invalid credentials');
    err.status = 401;
    throw err;
  }

  const ok = await comparePassword(password, user.passwordHash);
  if (!ok) {
    const err = new Error('Invalid credentials');
    err.status = 401;
    throw err;
  }

  if (!user.isActive) {
    const err = new Error('Account disabled');
    err.status = 403;
    throw err;
  }

  // Backfill registration ID for older accounts
  try {
    await ensureUserRegistrationId(user, User, subdomain);
  } catch (err) {
    console.error('[registrationId] backfill failed:', err?.message || err);
  }

  user.lastLoginAt = new Date();
  await user.save();

  const populated = await User.findById(user._id).populate('roleId');

  const refreshPlain = signRefreshToken({
    sub: populated._id.toString(),
    orgId: populated.orgId.toString(),
    subdomain,
    type: 'refresh',
  });

  await storeRefreshToken(models, {
    userId: populated._id,
    orgId: populated.orgId,
    refreshPlain,
    req,
  });

  return buildTokenResponse(populated, refreshPlain, subdomain);
}

async function storeRefreshToken(models, { userId, orgId, refreshPlain, req }) {
  const { RefreshToken } = models;
  const tokenHash = hashToken(refreshPlain);
  const decoded = verifyRefreshToken(refreshPlain);
  const expiresAt = new Date(decoded.exp * 1000);

  await RefreshToken.create({
    userId, 
    orgId,
    tokenHash,
    userAgent: req?.headers?.['user-agent'],
    expiresAt,
  });
}

export async function refreshSession({ refreshToken, req }) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    const err = new Error('Invalid refresh token');
    err.status = 401;
    throw err;
  }

  if (payload.type !== 'refresh') {
    const err = new Error('Invalid refresh token');
    err.status = 401;
    throw err;
  }

  if (!payload.subdomain) {
    const err = new Error('Please sign in again');
    err.status = 401;
    throw err;
  }

  const models = await getTenantModels(payload.subdomain);
  await ensureTenantCatalog(models, payload.subdomain);
  const { RefreshToken, User } = models;

  const tokenHash = hashToken(refreshToken);
  const record = await RefreshToken.findOne({ tokenHash, revokedAt: null });
  if (!record || record.expiresAt < new Date()) {
    const err = new Error('Refresh token expired or revoked');
    err.status = 401;
    throw err;
  }

  const user = await User.findById(payload.sub).populate('roleId');
  if (!user || !user.isActive) {
    const err = new Error('User not found');
    err.status = 401;
    throw err;
  }

  record.revokedAt = new Date();
  await record.save();

  const refreshPlain = signRefreshToken({
    sub: user._id.toString(),
    orgId: user.orgId.toString(),
    subdomain: payload.subdomain,
    type: 'refresh',
  });

  await storeRefreshToken(models, {
    userId: user._id,
    orgId: user.orgId,
    refreshPlain,
    req,
  });

  return buildTokenResponse(user, refreshPlain, payload.subdomain);
}

export async function logout({ refreshToken }) {
  if (!refreshToken) return;
  try {
    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      return;
    }
    if (!payload.subdomain) return;
    const models = await getTenantModels(payload.subdomain);
    const tokenHash = hashToken(refreshToken);
    await models.RefreshToken.updateOne({ tokenHash }, { $set: { revokedAt: new Date() } });
  } catch {
    /* ignore */
  }
}

export async function acceptInvite({ token, password, orgId }, models) {
  const { User } = models;

  const user = await User.findOne({
    orgId,
    inviteToken: token,
    inviteExpiresAt: { $gt: new Date() },
  }).select('+inviteToken +passwordHash');

  if (!user) {
    const err = new Error('Invalid or expired invitation');
    err.status = 400;
    throw err;
  }

  user.passwordHash = await hashPassword(password);
  user.inviteToken = undefined;
  user.inviteExpiresAt = undefined;
  await user.save();

  const populated = await User.findById(user._id).populate('roleId');

  const org = await Organization.findById(orgId);
  const subdomain = org?.subdomain;
  if (!subdomain) {
    const err = new Error('Organization not found');
    err.status = 400;
    throw err;
  }

  const refreshPlain = signRefreshToken({
    sub: populated._id.toString(),
    orgId: populated.orgId.toString(),
    subdomain,
    type: 'refresh',
  });

  await storeRefreshToken(models, {
    userId: populated._id,
    orgId: populated.orgId,
    refreshPlain,
    req: null,
  });

  return buildTokenResponse(populated, refreshPlain, subdomain);
}

function identifierFilter(orgId, raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (value.includes('@')) return { orgId, email: value.toLowerCase() };
  return { orgId, registrationId: value.toUpperCase().replace(/\s+/g, '') };
}

function maskEmail(email) {
  const [name, domain] = String(email || '').split('@');
  if (!domain) return '';
  return `${name.slice(0, 1)}***@${domain}`;
}

function otpMatches(plain, hash) {
  const digest = hashToken(String(plain || '').trim());
  const a = Buffer.from(digest);
  const b = Buffer.from(String(hash || ''));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function requestPasswordOtp({ identifier, orgId }, req) {
  const { User } = req.tenantModels;
  const query = identifierFilter(orgId, identifier);
  if (!query) return { ok: true };

  const user = await User.findOne(query).select('+passwordHash +passwordResetOtpHash');
  if (!user || !user.isActive || !user.email || !user.passwordHash) return { ok: true };

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  user.passwordResetOtpHash = hashToken(code);
  user.passwordResetOtpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
  user.passwordResetOtpAttempts = 0;
  await user.save();

  const orgName = req.tenant?.organization?.name || req.tenant?.subdomain;
  const delivery = await sendPasswordResetOtp({ to: user.email, orgName, code });
  if (!delivery.sent && process.env.NODE_ENV === 'production') {
    const err = new Error('Could not send the email. Try again in a moment.');
    err.status = 503;
    throw err;
  }

  return { ok: true, hint: maskEmail(user.email) };
}

export async function resetPasswordWithOtp({ identifier, otp, password, orgId }, req) {
  const { User, RefreshToken } = req.tenantModels;
  const query = identifierFilter(orgId, identifier);
  const user = query
    ? await User.findOne(query).select('+passwordResetOtpHash +passwordHash')
    : null;

  const invalid = () => {
    const err = new Error('That code is invalid or expired');
    err.status = 400;
    return err;
  };

  if (!user?.passwordResetOtpHash || !user.passwordResetOtpExpiresAt) throw invalid();

  if (user.passwordResetOtpExpiresAt.getTime() < Date.now() || (user.passwordResetOtpAttempts || 0) >= 5) {
    user.passwordResetOtpHash = null;
    user.passwordResetOtpExpiresAt = null;
    user.passwordResetOtpAttempts = 0;
    await user.save();
    throw invalid();
  }

  if (!otpMatches(otp, user.passwordResetOtpHash)) {
    user.passwordResetOtpAttempts = (user.passwordResetOtpAttempts || 0) + 1;
    await user.save();
    throw invalid();
  }

  user.passwordHash = await hashPassword(password);
  user.passwordResetOtpHash = null;
  user.passwordResetOtpExpiresAt = null;
  user.passwordResetOtpAttempts = 0;
  await user.save();

  await RefreshToken.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
  return { ok: true };
}
