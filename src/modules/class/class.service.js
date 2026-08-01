import mongoose from 'mongoose';
import { PERMISSION_KEYS } from '../../constants/permissions.js';
import { logActivity } from '../../utils/activity.js';

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

function buildClassName(masterName, section) {
  const s = (section || '').trim();
  return s ? `${masterName} ${s}` : masterName;
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

async function loadTeachersByClass(models, classIds) {
  const { ClassMember, User } = models;
  if (!classIds.length) return new Map();

  const members = await ClassMember.find({
    classId: { $in: classIds },
    role: 'teacher',
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
    if (!byClass.has(cid)) byClass.set(cid, []);
    const u = userMap.get(String(m.userId));
    if (!u) continue;
    byClass.get(cid).push({
      id: String(u._id),
      email: u.email,
      label: displayName(u),
      hierarchyRole: u.hierarchyRole,
    });
  }
  return byClass;
}

async function loadStudentsByClass(models, classIds) {
  const { Enrollment, ClassMember, User } = models;
  if (!classIds.length) return new Map();

  const enrollments = await Enrollment.find({
    academicClassId: { $in: classIds },
    isActive: true,
  }).lean();

  const byClass = new Map();
  const enrolledStudentIds = new Set();

  if (enrollments.length) {
    const userIds = [...new Set(enrollments.map((e) => String(e.studentId)))];
    const users = await User.find({ _id: { $in: userIds }, isActive: { $ne: false } }).lean();
    const userMap = new Map(users.map((u) => [String(u._id), u]));

    for (const e of enrollments) {
      const cid = String(e.academicClassId);
      if (!byClass.has(cid)) byClass.set(cid, []);
      const u = userMap.get(String(e.studentId));
      if (!u) continue;
      enrolledStudentIds.add(`${cid}:${String(e.studentId)}`);
      byClass.get(cid).push({
        id: String(u._id),
        email: u.email,
        label: displayName(u),
        hierarchyRole: u.hierarchyRole,
        enrollmentId: String(e._id),
      });
    }
  }

  // Legacy fallback: ClassMember role=student for classes without enrollments yet
  const members = await ClassMember.find({
    classId: { $in: classIds },
    role: 'student',
    isActive: true,
  }).lean();

  if (members.length) {
    const userIds = [...new Set(members.map((m) => String(m.userId)))];
    const users = await User.find({ _id: { $in: userIds }, isActive: { $ne: false } }).lean();
    const userMap = new Map(users.map((u) => [String(u._id), u]));

    for (const m of members) {
      const cid = String(m.classId);
      const key = `${cid}:${String(m.userId)}`;
      if (enrolledStudentIds.has(key)) continue;
      if (!byClass.has(cid)) byClass.set(cid, []);
      const u = userMap.get(String(m.userId));
      if (!u) continue;
      byClass.get(cid).push({
        id: String(u._id),
        email: u.email,
        label: displayName(u),
        hierarchyRole: u.hierarchyRole,
      });
    }
  }

  return byClass;
}

function serializeClass(doc, extras = {}) {
  return {
    id: String(doc._id),
    name: doc.name,
    description: doc.description || '',
    academicYear: doc.academicYear || '',
    academicYearId: doc.academicYearId ? String(doc.academicYearId) : null,
    classMasterId: doc.classMasterId ? String(doc.classMasterId) : null,
    section: doc.section || '',
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

async function resolveYearAndMaster(models, orgId, body) {
  const { AcademicYear, ClassMaster } = models;
  const oid = orgOid(orgId);

  let year = null;
  let master = null;

  if (body.academicYearId) {
    year = await AcademicYear.findOne({
      _id: body.academicYearId,
      orgId: oid,
      ...ACTIVE_CLASS,
    }).lean();
    if (!year) {
      const err = new Error('Academic year not found');
      err.status = 400;
      throw err;
    }
  }

  if (body.classMasterId) {
    master = await ClassMaster.findOne({
      _id: body.classMasterId,
      orgId: oid,
      ...ACTIVE_CLASS,
    }).lean();
    if (!master) {
      const err = new Error('Class master not found');
      err.status = 400;
      throw err;
    }
  }

  return { year, master };
}

/**
 * Replace active teacher memberships.
 */
async function syncTeachers(models, orgId, classId, userIds) {
  const { ClassMember } = models;
  const oid = orgOid(orgId);
  const desired = new Set(userIds.map(String));
  const role = 'teacher';

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

/**
 * Sync student enrollments for an academic class.
 * Never reuses ended enrollments across years — ends removed, creates new for added.
 */
async function syncEnrollments(models, orgId, academicClass, studentIds) {
  const { Enrollment, ClassMember } = models;
  const oid = orgOid(orgId);
  const desired = new Set(studentIds.map(String));
  const classId = academicClass._id;

  if (!academicClass.academicYearId) {
    // Legacy class without year: keep ClassMember student sync
    const existing = await ClassMember.find({ classId, role: 'student' }).lean();
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
          role: 'student',
          isActive: true,
          endedAt: null,
        });
      }
    }
    return;
  }

  const yearId = academicClass.academicYearId;
  const existing = await Enrollment.find({
    orgId: oid,
    academicClassId: classId,
  }).lean();
  const byStudent = new Map(existing.map((e) => [String(e.studentId), e]));

  for (const e of existing) {
    const sid = String(e.studentId);
    if (!desired.has(sid) && e.isActive) {
      await Enrollment.updateOne(
        { _id: e._id },
        { $set: { isActive: false, status: 'ended', endedAt: new Date() } }
      );
    }
  }

  for (const sid of desired) {
    const prev = byStudent.get(sid);
    if (prev) {
      if (!prev.isActive) {
        // Student was previously in this same class — reactivate only if no other active enrollment this year
        const otherActive = await Enrollment.findOne({
          academicYearId: yearId,
          studentId: sid,
          isActive: true,
          _id: { $ne: prev._id },
        }).lean();
        if (otherActive) {
          await Enrollment.updateOne(
            { _id: otherActive._id },
            { $set: { isActive: false, status: 'transferred', endedAt: new Date() } }
          );
        }
        await Enrollment.updateOne(
          { _id: prev._id },
          {
            $set: {
              isActive: true,
              status: 'active',
              endedAt: null,
              academicClassId: classId,
              enrolledAt: new Date(),
            },
          }
        );
      }
    } else {
      const otherActive = await Enrollment.findOne({
        academicYearId: yearId,
        studentId: sid,
        isActive: true,
      });
      if (otherActive) {
        otherActive.isActive = false;
        otherActive.status = 'transferred';
        otherActive.endedAt = new Date();
        await otherActive.save();
      }

      await Enrollment.create({
        orgId: oid,
        studentId: new mongoose.Types.ObjectId(sid),
        academicClassId: classId,
        academicYearId: yearId,
        status: 'active',
        isActive: true,
        enrolledAt: new Date(),
        endedAt: null,
        previousEnrollmentId: otherActive?._id || null,
      });
    }
  }
}

export async function listClasses(models, actor, orgId, query = {}) {
  if (!canViewClasses(actor)) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }

  const { Class } = models;
  const filter = { orgId: orgOid(orgId), ...ACTIVE_CLASS };

  if (query.academicYearId) {
    filter.academicYearId = query.academicYearId;
  }

  if (!canManageClasses(actor) && actor.hierarchyRole === 'subordinate') {
    const classIds = await activeClassIdsForTeacher(models, orgId, actor._id);
    filter._id = { $in: classIds };
  }

  const classes = await Class.find(filter).sort({ academicYear: -1, name: 1 }).lean();
  const ids = classes.map((c) => c._id);
  const [teachersByClass, studentsByClass] = await Promise.all([
    loadTeachersByClass(models, ids),
    loadStudentsByClass(models, ids),
  ]);

  return {
    classes: classes.map((c) => {
      const cid = String(c._id);
      return serializeClass(c, {
        teachers: teachersByClass.get(cid) || [],
        students: studentsByClass.get(cid) || [],
      });
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

  const [teachersByClass, studentsByClass] = await Promise.all([
    loadTeachersByClass(models, [doc._id]),
    loadStudentsByClass(models, [doc._id]),
  ]);
  const cid = String(doc._id);
  return serializeClass(doc, {
    teachers: teachersByClass.get(cid) || [],
    students: studentsByClass.get(cid) || [],
  });
}

export async function createClass(models, actor, orgId, body, ip) {
  if (!canManageClasses(actor)) {
    const err = new Error('Only administrators may manage classes');
    err.status = 403;
    throw err;
  }

  const { Class } = models;
  const oid = orgOid(orgId);
  const { year, master } = await resolveYearAndMaster(models, orgId, body);

  if (!year || !master) {
    const err = new Error('academicYearId and classMasterId are required');
    err.status = 400;
    throw err;
  }

  const section = (body.section || '').trim();
  const name = body.name?.trim() || buildClassName(master.name, section);

  const clash = await Class.findOne({
    orgId: oid,
    academicYearId: year._id,
    classMasterId: master._id,
    section,
    ...ACTIVE_CLASS,
  }).lean();
  if (clash) {
    const err = new Error(
      `Academic class "${name}" already exists for ${year.label}`
    );
    err.status = 409;
    throw err;
  }

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
    orgId: oid,
    name,
    description: body.description || '',
    academicYear: year.label,
    academicYearId: year._id,
    classMasterId: master._id,
    section,
    createdBy: actor._id,
    isActive: true,
  });

  await syncTeachers(models, orgId, doc._id, teacherIds);
  await syncEnrollments(models, orgId, doc, studentIds);

  await logActivity({
    models,
    orgId: oid,
    actorId: actor._id,
    action: 'academic_class.created',
    resourceType: 'Class',
    resourceId: doc._id,
    metadata: { name: doc.name, academicYear: year.label },
    ip,
  });

  return getClass(models, actor, orgId, doc._id);
}

export async function updateClass(models, actor, orgId, classId, body, ip) {
  if (!canManageClasses(actor)) {
    const err = new Error('Only administrators may manage classes');
    err.status = 403;
    throw err;
  }

  const { Class } = models;
  const oid = orgOid(orgId);
  const doc = await Class.findOne({ _id: classId, orgId: oid, ...ACTIVE_CLASS });
  if (!doc) {
    const err = new Error('Class not found');
    err.status = 404;
    throw err;
  }

  const yearId = body.academicYearId !== undefined ? body.academicYearId : doc.academicYearId;
  const masterId = body.classMasterId !== undefined ? body.classMasterId : doc.classMasterId;
  const section =
    body.section !== undefined ? String(body.section).trim() : doc.section || '';

  const { year, master } = await resolveYearAndMaster(models, orgId, {
    academicYearId: yearId ? String(yearId) : undefined,
    classMasterId: masterId ? String(masterId) : undefined,
  });

  if (year) {
    doc.academicYearId = year._id;
    doc.academicYear = year.label;
  }
  if (master) {
    doc.classMasterId = master._id;
  }
  if (body.section !== undefined) doc.section = section;

  if (body.name !== undefined) {
    doc.name = body.name;
  } else if (master) {
    doc.name = buildClassName(master.name, doc.section);
  }

  if (body.description !== undefined) doc.description = body.description;
  if (body.isActive !== undefined) doc.isActive = body.isActive;

  if (doc.academicYearId && doc.classMasterId) {
    const clash = await Class.findOne({
      orgId: oid,
      academicYearId: doc.academicYearId,
      classMasterId: doc.classMasterId,
      section: doc.section || '',
      _id: { $ne: doc._id },
      ...ACTIVE_CLASS,
    }).lean();
    if (clash) {
      const err = new Error(`Academic class "${doc.name}" already exists for this year`);
      err.status = 409;
      throw err;
    }
  }

  await doc.save();

  if (body.teacherIds !== undefined) {
    const teacherIds = await assertUsersForRole(
      models,
      orgId,
      body.teacherIds,
      'subordinate',
      'teacher'
    );
    await syncTeachers(models, orgId, doc._id, teacherIds);
  }

  if (body.studentIds !== undefined) {
    const studentIds = await assertUsersForRole(models, orgId, body.studentIds, 'user', 'student');
    await syncEnrollments(models, orgId, doc, studentIds);
  }

  await logActivity({
    models,
    orgId: oid,
    actorId: actor._id,
    action: 'academic_class.updated',
    resourceType: 'Class',
    resourceId: doc._id,
    metadata: { name: doc.name, changes: Object.keys(body) },
    ip,
  });

  return getClass(models, actor, orgId, doc._id);
}

export async function deleteClass(models, actor, orgId, classId, ip) {
  if (!canManageClasses(actor)) {
    const err = new Error('Only administrators may manage classes');
    err.status = 403;
    throw err;
  }

  const { Class, ClassMember, Enrollment } = models;
  const oid = orgOid(orgId);
  const doc = await Class.findOne({ _id: classId, orgId: oid, ...ACTIVE_CLASS });
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

  await Enrollment.updateMany(
    { academicClassId: doc._id, isActive: true },
    { $set: { isActive: false, status: 'ended', endedAt: new Date() } }
  );

  await logActivity({
    models,
    orgId: oid,
    actorId: actor._id,
    action: 'academic_class.archived',
    resourceType: 'Class',
    resourceId: doc._id,
    metadata: { name: doc.name },
    ip,
  });

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
