import mongoose from 'mongoose';
import { PERMISSION_KEYS } from '../../constants/permissions.js';

const ACTIVE_CLASS = { deletedAt: null };

function orgOid(orgId) {
  return new mongoose.Types.ObjectId(String(orgId));
}

function displayName(u) {
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return name || u.email;
}

function canManageClasses(actor) {
  return (
    actor.hierarchyRole === 'admin' &&
    (actor.permissions.includes(PERMISSION_KEYS.CLASS_MANAGE) ||
      actor.permissions.includes(PERMISSION_KEYS.SETTINGS_MANAGE))
  );
}

function canViewClasses(actor) {
  return (
    canManageClasses(actor) ||
    actor.permissions.includes(PERMISSION_KEYS.ASSESSMENT_CREATE) ||
    actor.permissions.includes(PERMISSION_KEYS.USER_CREATE)
  );
}

async function activeClassIdsForTeacher(models, orgId, teacherId) {
  const { ClassMember } = models;
  const rows = await ClassMember.find({
    orgId: orgOid(orgId),
    userId: teacherId,
    role: 'teacher',
    isActive: true,
  })
    .select('classId')
    .lean();
  return rows.map((r) => r.classId);
}

async function loadMembersByClass(models, classIds) {
  const { ClassMember, User } = models;
  if (!classIds.length) return new Map();

  const members = await ClassMember.find({
    classId: { $in: classIds },
    isActive: true,
  }).lean();

  const userIds = [...new Set(members.map((m) => String(m.userId)))];
  const users = userIds.length
    ? await User.find({ _id: { $in: userIds }, isActive: { $ne: false } }).lean()
    : [];
  const userMap = new Map(users.map((u) => [String(u._id), u]));

  const byClass = new Map();
  for (const m of members) {
    const cid = String(m.classId);
    if (!byClass.has(cid)) byClass.set(cid, { teachers: [], students: [] });
    const u = userMap.get(String(m.userId));
    if (!u) continue;
    const row = {
      id: String(u._id),
      email: u.email,
      label: displayName(u),
      hierarchyRole: u.hierarchyRole,
    };
    if (m.role === 'teacher') byClass.get(cid).teachers.push(row);
    else byClass.get(cid).students.push(row);
  }
  return byClass;
}

function serializeClass(doc, extras = {}) {
  return {
    id: String(doc._id),
    name: doc.name,
    description: doc.description || '',
    academicYear: doc.academicYear || '',
    createdBy: doc.createdBy ? String(doc.createdBy) : null,
    isActive: doc.isActive !== false,
    teacherCount: extras.teachers?.length ?? extras.teacherCount ?? 0,
    studentCount: extras.students?.length ?? extras.studentCount ?? 0,
    teachers: extras.teachers,
    students: extras.students,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function assertUsersForRole(models, orgId, userIds, expectedHierarchy, label) {
  const { User } = models;
  const unique = [...new Set(userIds.map(String))];
  if (!unique.length) return [];

  const users = await User.find({
    _id: { $in: unique },
    orgId: orgOid(orgId),
    hierarchyRole: expectedHierarchy,
    isActive: { $ne: false },
  }).lean();

  if (users.length !== unique.length) {
    const found = new Set(users.map((u) => String(u._id)));
    const missing = unique.find((id) => !found.has(id));
    const err = new Error(`Invalid ${label}: ${missing}`);
    err.status = 400;
    throw err;
  }
  return unique;
}

/**
 * Replace active memberships for a role. Ends removed members; reactivates or creates for new ones.
 */
async function syncMembers(models, orgId, classId, role, userIds) {
  const { ClassMember } = models;
  const oid = orgOid(orgId);
  const desired = new Set(userIds.map(String));

  const existing = await ClassMember.find({ classId, role }).lean();
  const byUser = new Map(existing.map((m) => [String(m.userId), m]));

  for (const m of existing) {
    const uid = String(m.userId);
    if (!desired.has(uid) && m.isActive) {
      await ClassMember.updateOne(
        { _id: m._id },
        { $set: { isActive: false, endedAt: new Date() } }
      );
    }
  }

  for (const uid of desired) {
    const prev = byUser.get(uid);
    if (prev) {
      if (!prev.isActive) {
        await ClassMember.updateOne(
          { _id: prev._id },
          { $set: { isActive: true, endedAt: null } }
        );
      }
    } else {
      await ClassMember.create({
        orgId: oid,
        classId,
        userId: new mongoose.Types.ObjectId(uid),
        role,
        isActive: true,
        endedAt: null,
      });
    }
  }
}

export async function listClasses(models, actor, orgId) {
  if (!canViewClasses(actor)) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }

  const { Class } = models;
  const filter = { orgId: orgOid(orgId), ...ACTIVE_CLASS };

  if (!canManageClasses(actor) && actor.hierarchyRole === 'subordinate') {
    const classIds = await activeClassIdsForTeacher(models, orgId, actor._id);
    filter._id = { $in: classIds };
  }

  const classes = await Class.find(filter).sort({ academicYear: -1, name: 1 }).lean();
  const byClass = await loadMembersByClass(
    models,
    classes.map((c) => c._id)
  );

  return {
    classes: classes.map((c) => {
      const members = byClass.get(String(c._id)) || { teachers: [], students: [] };
      return serializeClass(c, members);
    }),
  };
}

export async function getClass(models, actor, orgId, classId) {
  if (!canViewClasses(actor)) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }

  const { Class } = models;
  const filter = { _id: classId, orgId: orgOid(orgId), ...ACTIVE_CLASS };

  if (!canManageClasses(actor) && actor.hierarchyRole === 'subordinate') {
    const classIds = await activeClassIdsForTeacher(models, orgId, actor._id);
    if (!classIds.some((id) => String(id) === String(classId))) {
      const err = new Error('Class not found');
      err.status = 404;
      throw err;
    }
  }

  const doc = await Class.findOne(filter).lean();
  if (!doc) {
    const err = new Error('Class not found');
    err.status = 404;
    throw err;
  }

  const byClass = await loadMembersByClass(models, [doc._id]);
  const members = byClass.get(String(doc._id)) || { teachers: [], students: [] };
  return serializeClass(doc, members);
}

export async function createClass(models, actor, orgId, body) {
  if (!canManageClasses(actor)) {
    const err = new Error('Only administrators may manage classes');
    err.status = 403;
    throw err;
  }

  const { Class } = models;
  const teacherIds = await assertUsersForRole(
    models,
    orgId,
    body.teacherIds || [],
    'subordinate',
    'teacher'
  );
  const studentIds = await assertUsersForRole(
    models,
    orgId,
    body.studentIds || [],
    'user',
    'student'
  );

  const doc = await Class.create({
    orgId: orgOid(orgId),
    name: body.name,
    description: body.description || '',
    academicYear: body.academicYear || '',
    createdBy: actor._id,
    isActive: true,
  });

  await syncMembers(models, orgId, doc._id, 'teacher', teacherIds);
  await syncMembers(models, orgId, doc._id, 'student', studentIds);

  return getClass(models, actor, orgId, doc._id);
}

export async function updateClass(models, actor, orgId, classId, body) {
  if (!canManageClasses(actor)) {
    const err = new Error('Only administrators may manage classes');
    err.status = 403;
    throw err;
  }

  const { Class } = models;
  const doc = await Class.findOne({ _id: classId, orgId: orgOid(orgId), ...ACTIVE_CLASS });
  if (!doc) {
    const err = new Error('Class not found');
    err.status = 404;
    throw err;
  }

  if (body.name !== undefined) doc.name = body.name;
  if (body.description !== undefined) doc.description = body.description;
  if (body.academicYear !== undefined) doc.academicYear = body.academicYear;
  if (body.isActive !== undefined) doc.isActive = body.isActive;
  await doc.save();

  if (body.teacherIds !== undefined) {
    const teacherIds = await assertUsersForRole(
      models,
      orgId,
      body.teacherIds,
      'subordinate',
      'teacher'
    );
    await syncMembers(models, orgId, doc._id, 'teacher', teacherIds);
  }

  if (body.studentIds !== undefined) {
    const studentIds = await assertUsersForRole(models, orgId, body.studentIds, 'user', 'student');
    await syncMembers(models, orgId, doc._id, 'student', studentIds);
  }

  return getClass(models, actor, orgId, doc._id);
}

export async function deleteClass(models, actor, orgId, classId) {
  if (!canManageClasses(actor)) {
    const err = new Error('Only administrators may manage classes');
    err.status = 403;
    throw err;
  }

  const { Class, ClassMember } = models;
  const doc = await Class.findOne({ _id: classId, orgId: orgOid(orgId), ...ACTIVE_CLASS });
  if (!doc) {
    const err = new Error('Class not found');
    err.status = 404;
    throw err;
  }

  doc.deletedAt = new Date();
  doc.isActive = false;
  await doc.save();

  await ClassMember.updateMany(
    { classId: doc._id, isActive: true },
    { $set: { isActive: false, endedAt: new Date() } }
  );

  return { ok: true };
}

/** Teachers + students available for class assignment (admin). */
export async function listClassMemberOptions(models, actor, orgId) {
  if (!canManageClasses(actor)) {
    const err = new Error('Only administrators may manage classes');
    err.status = 403;
    throw err;
  }

  const { User } = models;
  const oid = orgOid(orgId);
  const [teachers, students] = await Promise.all([
    User.find({
      orgId: oid,
      hierarchyRole: 'subordinate',
      isActive: { $ne: false },
    })
      .sort({ firstName: 1, lastName: 1, email: 1 })
      .lean(),
    User.find({
      orgId: oid,
      hierarchyRole: 'user',
      isActive: { $ne: false },
    })
      .sort({ firstName: 1, lastName: 1, email: 1 })
      .lean(),
  ]);

  return {
    teachers: teachers.map((u) => ({
      id: String(u._id),
      email: u.email,
      label: displayName(u),
    })),
    students: students.map((u) => ({
      id: String(u._id),
      email: u.email,
      label: displayName(u),
    })),
  };
}
