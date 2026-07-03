import crypto from 'crypto';
import mongoose from 'mongoose';
import { hashPassword } from '../../utils/hash.js';
import { PERMISSION_KEYS } from '../../constants/permissions.js';
import { sendInvitationEmail } from '../../utils/mailer.js';
import { Organization } from '../../models/Organization.js';

const DEFAULT_SUBORDINATE_PERMS = [
  PERMISSION_KEYS.USER_CREATE,
  PERMISSION_KEYS.ASSESSMENT_CREATE,
  PERMISSION_KEYS.ASSESSMENT_VIEW,
];

const DEFAULT_MEMBER_PERMS = [
  PERMISSION_KEYS.ASSESSMENT_VIEW,
  PERMISSION_KEYS.ASSESSMENT_SUBMIT,
];

/** Not assignable to line members (`hierarchyRole: user`) — prevents privilege escalation. */
const ORG_LEVEL_PERMISSION_KEYS = new Set([
  PERMISSION_KEYS.USER_CREATE,
  PERMISSION_KEYS.SUBORDINATE_CREATE,
  PERMISSION_KEYS.SETTINGS_MANAGE,
]);

/** Student-only permissions — teachers may grant these when creating students without holding them. */
const MEMBER_ONLY_PERMISSION_KEYS = new Set([PERMISSION_KEYS.ASSESSMENT_SUBMIT]);

function assertMemberPermissionsFromLead(creator, keys) {
  for (const key of keys) {
    if (MEMBER_ONLY_PERMISSION_KEYS.has(key)) continue;
    if (!creator.permissions.includes(key)) {
      const err = new Error(`Cannot assign permission you do not have: ${key}`);
      err.status = 403;
      throw err;
    }
    if (ORG_LEVEL_PERMISSION_KEYS.has(key)) {
      const err = new Error(`Team members cannot be granted: ${key}`);
      err.status = 403;
      throw err;
    }
  }
}

/** Admins without settings_manage may only grant keys they themselves hold. */
function assertAssignablePermissionSubset(actor, keys) {
  for (const key of keys) {
    if (!actor.permissions.includes(key)) {
      const err = new Error(`Cannot assign permission you do not have: ${key}`);
      err.status = 403;
      throw err;
    }
  }
}

export function serializeUserDoc(u) {
  return {
    id: u._id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    hierarchyRole: u.hierarchyRole,
    parentUserId: u.parentUserId,
    permissions: u.permissions || [],
    isActive: u.isActive,
    createdAt: u.createdAt,
  };
}

function isSubordinateActor(actor) {
  const h = actor?.hierarchyRole;
  if (h == null) return false;
  return String(h).toLowerCase().trim() === 'subordinate';
}

/**
 * List users in the org. Teachers only see direct reports (`parentUserId` = self, role `user`).
 * Administrators see all students in the org.
 */
export async function listUsers(models, orgId, actor, { search, page = 1, limit = 20 }) {
  const { User } = models;
  const orgOid = new mongoose.Types.ObjectId(String(orgId));

  const baseFilter = isSubordinateActor(actor)
    ? {
        orgId: orgOid,
        parentUserId: actor._id,
        hierarchyRole: 'user',
      }
    : {
        orgId: orgOid,
        hierarchyRole: 'user',
      };

  let q;
  if (search && String(search).trim()) {
    const escaped = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(escaped, 'i');
    q = {
      $and: [baseFilter, { $or: [{ email: rx }, { firstName: rx }, { lastName: rx }] }],
    };
  } else {
    q = baseFilter;
  }

  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    User.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(q),
  ]);

  const users = items.map((u) => serializeUserDoc(u));

  return { users, total, page, limit };
}

export async function listSubordinates(models, orgId, adminId) {
  const { User } = models;
  const items = await User.find({
    orgId,
    hierarchyRole: 'subordinate',
    parentUserId: adminId,
  })
    .sort({ createdAt: -1 })
    .lean();
  return items.map((u) => serializeUserDoc(u));
}

export async function createSubordinate(models, creator, orgId, body) {
  const { User, Role } = models;
  if (!creator.permissions.includes(PERMISSION_KEYS.SUBORDINATE_CREATE)) {
    const err = new Error('Missing permission: subordinate_create');
    err.status = 403;
    throw err;
  }
  if (creator.hierarchyRole !== 'admin') {
    const err = new Error('Only organization administrators may create subordinate leads');
    err.status = 403;
    throw err;
  }

  const dup = await User.findOne({ orgId, email: body.email.toLowerCase() });
  if (dup) {
    const err = new Error('User with this email already exists');
    err.status = 409;
    throw err;
  }

  const subRole = await Role.findOneAndUpdate(
    { orgId, hierarchy: 'subordinate' },
    {
      $setOnInsert: {
        orgId,
        name: 'Teacher',
        hierarchy: 'subordinate',
        permissionKeys: DEFAULT_SUBORDINATE_PERMS,
        isSystem: true,
      },
    },
    { upsert: true, new: true }
  );

  const passwordHash = await hashPassword(body.password);

  const user = await User.create({
    orgId,
    email: body.email.toLowerCase(),
    passwordHash,
    firstName: body.firstName || '',
    lastName: body.lastName || '',
    hierarchyRole: 'subordinate',
    parentUserId: creator._id,
    roleId: subRole._id,
    permissions: body.permissions?.length ? body.permissions : DEFAULT_SUBORDINATE_PERMS,
  });

  return serializeUserDoc(user.toObject());
}

export async function createMember(models, creator, orgId, body) {
  const { User, Role } = models;
  if (!creator.permissions.includes(PERMISSION_KEYS.USER_CREATE)) {
    const err = new Error('Missing permission: user_create');
    err.status = 403;
    throw err;
  }

  const dup = await User.findOne({ orgId, email: body.email.toLowerCase() });
  if (dup) {
    const err = new Error('User with this email already exists');
    err.status = 409;
    throw err;
  }

  let parentUserId = creator._id;
  if (creator.hierarchyRole === 'admin') {
    if (!body.parentUserId) {
      const err = new Error('parentUserId is required when administrator creates a member');
      err.status = 400;
      throw err;
    }
    const parent = await User.findOne({ _id: body.parentUserId, orgId });
    if (!parent || parent.hierarchyRole !== 'subordinate') {
      const err = new Error('parentUserId must reference a subordinate lead in this organization');
      err.status = 400;
      throw err;
    }
    parentUserId = parent._id;
  }

  const memRole = await Role.findOneAndUpdate(
    { orgId, hierarchy: 'user' },
    {
      $setOnInsert: {
        orgId,
        name: 'Student',
        hierarchy: 'user',
        permissionKeys: DEFAULT_MEMBER_PERMS,
        isSystem: true,
      },
    },
    { upsert: true, new: true }
  );

  const password = body.password || crypto.randomBytes(12).toString('base64url');
  const passwordHash = await hashPassword(password);

  let memberPermissions = body.permissions?.length ? body.permissions : DEFAULT_MEMBER_PERMS;
  if (creator.hierarchyRole === 'subordinate') {
    assertMemberPermissionsFromLead(creator, memberPermissions);
  }

  const user = await User.create({
    orgId,
    email: body.email.toLowerCase(),
    passwordHash,
    firstName: body.firstName || '',
    lastName: body.lastName || '',
    hierarchyRole: 'user',
    parentUserId,
    roleId: memRole._id,
    permissions: memberPermissions,
  });

  return { user: serializeUserDoc(user.toObject()), generatedPassword: body.password ? undefined : password };
}

export async function updateUser(models, actor, orgId, userId, body) {
  const { User } = models;
  const target = await User.findOne({ _id: userId, orgId });
  if (!target) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  const parentMatchesActor = target.parentUserId?.toString() === actor._id.toString();
  const isSelf = actor._id.equals(target._id);

  const canManage =
    actor.permissions.includes(PERMISSION_KEYS.SETTINGS_MANAGE) ||
    (actor.permissions.includes(PERMISSION_KEYS.USER_CREATE) && (parentMatchesActor || isSelf)) ||
    (actor.permissions.includes(PERMISSION_KEYS.SUBORDINATE_CREATE) && parentMatchesActor);

  if (!canManage && !actor._id.equals(target._id)) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }

  if (body.permissions !== undefined) {
    const isSettingsManager = actor.permissions.includes(PERMISSION_KEYS.SETTINGS_MANAGE);
    const isLeadForMember =
      actor.hierarchyRole === 'subordinate' &&
      target.hierarchyRole === 'user' &&
      target.parentUserId?.toString() === actor._id.toString();
    /** Admin may tune subordinate leads & members; full catalog only with settings_manage. */
    const isAdminEditingNonAdmin =
      actor.hierarchyRole === 'admin' && target.hierarchyRole !== 'admin';

    if (!isSettingsManager && !isLeadForMember && !isAdminEditingNonAdmin) {
      const err = new Error('Forbidden: cannot update permissions for this user');
      err.status = 403;
      throw err;
    }

    if (isLeadForMember && !isSettingsManager) {
      assertMemberPermissionsFromLead(actor, body.permissions);
    } else if (isAdminEditingNonAdmin && !isSettingsManager) {
      assertAssignablePermissionSubset(actor, body.permissions);
    }
  }

  if (body.parentUserId !== undefined && actor.hierarchyRole !== 'admin') {
    const err = new Error('Only administrators may change hierarchy');
    err.status = 403;
    throw err;
  }

  const mustBeSettingsManagerForAnotherAdmin = () => {
    if (actor._id.equals(target._id)) return false;
    return target.hierarchyRole === 'admin';
  };

  if (body.email !== undefined) {
    const email = String(body.email).toLowerCase().trim();
    if (mustBeSettingsManagerForAnotherAdmin() && !actor.permissions.includes(PERMISSION_KEYS.SETTINGS_MANAGE)) {
      const err = new Error('Only settings managers may change another administrator email');
      err.status = 403;
      throw err;
    }
    if (email !== target.email) {
      const dup = await User.findOne({ orgId, email, _id: { $ne: target._id } });
      if (dup) {
        const err = new Error('Email already in use');
        err.status = 409;
        throw err;
      }
      target.email = email;
    }
  }

  if (body.password !== undefined) {
    if (mustBeSettingsManagerForAnotherAdmin() && !actor.permissions.includes(PERMISSION_KEYS.SETTINGS_MANAGE)) {
      const err = new Error('Only settings managers may reset another administrator password');
      err.status = 403;
      throw err;
    }
    target.passwordHash = await hashPassword(body.password);
  }

  Object.assign(target, {
    ...(body.firstName !== undefined && { firstName: body.firstName }),
    ...(body.lastName !== undefined && { lastName: body.lastName }),
    ...(body.permissions !== undefined && { permissions: body.permissions }),
    ...(body.isActive !== undefined && { isActive: body.isActive }),
    ...(body.parentUserId !== undefined && { parentUserId: body.parentUserId || null }),
  });

  await target.save();
  return serializeUserDoc(target.toObject());
}

export async function inviteUser(models, actor, orgId, body, appUrl) {
  const { User, Role } = models;
  if (!actor.permissions.includes(PERMISSION_KEYS.USER_CREATE)) {
    const err = new Error('Missing permission: user_create');
    err.status = 403;
    throw err;
  }

  const dup = await User.findOne({ orgId, email: body.email.toLowerCase() });
  if (dup) {
    const err = new Error('User already exists');
    err.status = 409;
    throw err;
  }

  let parentUserId = actor._id;
  if (actor.hierarchyRole === 'admin') {
    if (!body.parentUserId) {
      const err = new Error('parentUserId is required');
      err.status = 400;
      throw err;
    }
    const parent = await User.findOne({ _id: body.parentUserId, orgId });
    if (!parent || parent.hierarchyRole !== 'subordinate') {
      const err = new Error('Invalid parentUserId');
      err.status = 400;
      throw err;
    }
    parentUserId = parent._id;
  }

  const token = crypto.randomBytes(32).toString('hex');
  const inviteExpiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);

  const memRole = await Role.findOne({ orgId, hierarchy: 'user' });

  let invitePermissions = body.permissions?.length ? body.permissions : DEFAULT_MEMBER_PERMS;
  if (actor.hierarchyRole === 'subordinate') {
    assertMemberPermissionsFromLead(actor, invitePermissions);
  }

  const user = await User.create({
    orgId,
    email: body.email.toLowerCase(),
    passwordHash: await hashPassword(crypto.randomBytes(16).toString('hex')),
    firstName: body.firstName || '',
    lastName: body.lastName || '',
    hierarchyRole: 'user',
    parentUserId,
    roleId: memRole?._id,
    permissions: invitePermissions,
    inviteToken: token,
    inviteExpiresAt,
  });

  const org = await Organization.findById(orgId);
  const base = appUrl || process.env.FRONTEND_URL || 'http://localhost:5173';
  const inviteLink = `${base}/accept-invite?token=${token}&tenant=${org?.subdomain}`;

  await sendInvitationEmail({
    to: user.email,
    orgName: org?.name || 'Organization',
    inviteLink,
    inviterName: `${actor.firstName} ${actor.lastName}`.trim() || actor.email,
  });

  return { ok: true, userId: user._id };
}
