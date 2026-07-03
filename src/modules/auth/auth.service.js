import { Organization } from '../../models/Organization.js';
import { getTenantModels } from '../../db/tenantModels.js';
import { ensureTenantCatalog } from '../../db/tenantCatalog.js';
import { hashPassword, comparePassword, hashToken } from '../../utils/hash.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../utils/jwt.js';
import { ALL_PERMISSION_KEYS } from '../../constants/permissions.js';
import { env } from '../../config/env.js';

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
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    user: sanitizeUser(user),
  };
}

export function sanitizeUser(user) {
  return {
    id: user._id,
    email: user.email,
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
  const models = getTenantModels(subdomain);
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

  const admin = await User.create({
    orgId: org._id,
    email: adminEmail.toLowerCase(),
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
  const exists = await Organization.findOne({ subdomain: payload.subdomain.toLowerCase() });
  if (exists) {
    const err = new Error('Subdomain already taken');
    err.status = 409;
    throw err;
  }

  const org = await Organization.create({
    name: payload.organizationName,
    subdomain: payload.subdomain.toLowerCase(),
  });

  const admin = await provisionOrganizationAdmin(org, {
    adminEmail: payload.adminEmail,
    adminPassword: payload.adminPassword,
    firstName: payload.firstName,
    lastName: payload.lastName,
  });

  return {
    organization: {
      id: org._id,
      name: org.name,
      subdomain: org.subdomain,
    },
    user: sanitizeUser(admin),
  };
}

export async function login({ email, password, orgId }, req) {
  const models = req.tenantModels;
  const { User } = models;
  const subdomain = req.tenant.subdomain;

  const user = await User.findOne({ orgId, email: email.toLowerCase() }).select('+passwordHash');

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

  const models = getTenantModels(payload.subdomain);
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
    const models = getTenantModels(payload.subdomain);
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
