import mongoose from 'mongoose';
import { PERMISSION_KEYS } from '../../constants/permissions.js';
import { allowedStudentIdSet } from '../shared/studentScope.service.js';

const ACTIVE = { deletedAt: null };

function orgOid(orgId) {
  return new mongoose.Types.ObjectId(String(orgId));
}

function studentDisplayName(u) {
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return name || u.email;
}

function canManageGroups(actor) {
  return (
    actor.permissions.includes(PERMISSION_KEYS.ASSESSMENT_CREATE) ||
    actor.permissions.includes(PERMISSION_KEYS.USER_CREATE)
  );
}

function serializeGroup(doc, extras = {}) {
  return {
    id: String(doc._id),
    name: doc.name,
    description: doc.description || '',
    createdBy: doc.createdBy ? String(doc.createdBy) : null,
    studentIds: (doc.studentIds || []).map((id) => String(id)),
    memberCount: (doc.studentIds || []).length,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    ...extras,
  };
}

function groupFilter(actor, orgId) {
  const filter = { orgId: orgOid(orgId), ...ACTIVE };
  if (actor.hierarchyRole === 'subordinate') {
    filter.createdBy = actor._id;
  }
  return filter;
}

async function assertGroupAccess(models, actor, orgId, groupId) {
  const { StudentGroup } = models;
  const doc = await StudentGroup.findOne({ _id: groupId, ...groupFilter(actor, orgId) }).lean();
  if (!doc) {
    const err = new Error('Student group not found');
    err.status = 404;
    throw err;
  }
  return doc;
}

async function validateStudentIds(models, actor, orgId, studentIds) {
  const allowed = await allowedStudentIdSet(models, actor, orgId);
  const unique = [...new Set(studentIds.map(String))];
  for (const sid of unique) {
    if (!allowed.has(sid)) {
      const err = new Error(`Cannot add student: ${sid}`);
      err.status = 403;
      throw err;
    }
  }
  return unique;
}

export async function listStudentGroups(models, actor, orgId) {
  if (!canManageGroups(actor)) {
    const err = new Error('Missing permission: assessment_create');
    err.status = 403;
    throw err;
  }

  const { StudentGroup, User } = models;
  const groups = await StudentGroup.find(groupFilter(actor, orgId))
    .sort({ name: 1, updatedAt: -1 })
    .lean();

  const allStudentIds = [...new Set(groups.flatMap((g) => (g.studentIds || []).map(String)))];
  const students = allStudentIds.length
    ? await User.find({ _id: { $in: allStudentIds } }).lean()
    : [];
  const studentMap = new Map(students.map((s) => [String(s._id), s]));

  return {
    groups: groups.map((g) => {
      const members = (g.studentIds || [])
        .map((id) => studentMap.get(String(id)))
        .filter(Boolean)
        .map((u) => ({
          id: String(u._id),
          email: u.email,
          label: studentDisplayName(u),
        }));
      return serializeGroup(g, { members });
    }),
  };
}

export async function getStudentGroup(models, actor, orgId, groupId) {
  if (!canManageGroups(actor)) {
    const err = new Error('Missing permission: assessment_create');
    err.status = 403;
    throw err;
  }

  const { User } = models;
  const doc = await assertGroupAccess(models, actor, orgId, groupId);
  const students = doc.studentIds?.length
    ? await User.find({ _id: { $in: doc.studentIds } }).lean()
    : [];
  const members = students.map((u) => ({
    id: String(u._id),
    email: u.email,
    label: studentDisplayName(u),
  }));

  return serializeGroup(doc, { members });
}

export async function createStudentGroup(models, actor, orgId, body) {
  if (!canManageGroups(actor)) {
    const err = new Error('Missing permission: assessment_create');
    err.status = 403;
    throw err;
  }

  const { StudentGroup } = models;
  const studentIds = await validateStudentIds(models, actor, orgId, body.studentIds || []);

  const doc = await StudentGroup.create({
    orgId: orgOid(orgId),
    name: body.name,
    description: body.description || '',
    createdBy: actor._id,
    studentIds: studentIds.map((id) => new mongoose.Types.ObjectId(id)),
  });

  return getStudentGroup(models, actor, orgId, doc._id);
}

export async function updateStudentGroup(models, actor, orgId, groupId, body) {
  if (!canManageGroups(actor)) {
    const err = new Error('Missing permission: assessment_create');
    err.status = 403;
    throw err;
  }

  const { StudentGroup } = models;
  const doc = await StudentGroup.findOne({ _id: groupId, ...groupFilter(actor, orgId) });
  if (!doc) {
    const err = new Error('Student group not found');
    err.status = 404;
    throw err;
  }

  if (body.name !== undefined) doc.name = body.name;
  if (body.description !== undefined) doc.description = body.description;
  if (body.studentIds !== undefined) {
    const studentIds = await validateStudentIds(models, actor, orgId, body.studentIds);
    doc.studentIds = studentIds.map((id) => new mongoose.Types.ObjectId(id));
  }

  await doc.save();
  return getStudentGroup(models, actor, orgId, doc._id);
}

export async function deleteStudentGroup(models, actor, orgId, groupId) {
  if (!canManageGroups(actor)) {
    const err = new Error('Missing permission: assessment_create');
    err.status = 403;
    throw err;
  }

  const { StudentGroup } = models;
  const doc = await StudentGroup.findOne({ _id: groupId, ...groupFilter(actor, orgId) });
  if (!doc) {
    const err = new Error('Student group not found');
    err.status = 404;
    throw err;
  }

  doc.deletedAt = new Date();
  await doc.save();
  return { ok: true };
}

/** Resolve student IDs from group IDs the actor may use for assignment. */
export async function resolveGroupStudentIds(models, actor, orgId, groupIds) {
  const { StudentGroup } = models;
  const uniqueGroupIds = [...new Set(groupIds.map(String))];
  if (!uniqueGroupIds.length) return [];

  const groups = await StudentGroup.find({
    _id: { $in: uniqueGroupIds },
    ...groupFilter(actor, orgId),
  }).lean();

  if (groups.length !== uniqueGroupIds.length) {
    const err = new Error('One or more student groups not found');
    err.status = 404;
    throw err;
  }

  return [...new Set(groups.flatMap((g) => (g.studentIds || []).map(String)))];
}
