import mongoose from 'mongoose';

function orgOid(orgId) {
  return new mongoose.Types.ObjectId(String(orgId));
}

function studentDisplayName(u) {
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return name || u.email;
}

/**
 * For a teacher: map studentId → classes they share with that teacher.
 * Used so My students can show which class each student belongs to.
 */
export async function mapStudentClassesForTeacher(models, actor, orgId) {
  const { ClassMember, Enrollment, Class } = models;
  const oid = orgOid(orgId);
  const empty = new Map();

  if (actor.hierarchyRole !== 'subordinate') return empty;

  const teacherMemberships = await ClassMember.find({
    orgId: oid,
    userId: actor._id,
    role: 'teacher',
    isActive: true,
  })
    .select('classId')
    .lean();

  const classIds = teacherMemberships.map((m) => m.classId).filter(Boolean);
  if (!classIds.length) return empty;

  const classes = await Class.find({ _id: { $in: classIds }, orgId: oid })
    .select('name academicYear')
    .lean();
  const classById = new Map(
    classes.map((c) => [
      String(c._id),
      {
        id: String(c._id),
        name: c.name || 'Class',
        academicYear: c.academicYear || '',
      },
    ])
  );

  const [studentMemberships, enrollments] = await Promise.all([
    ClassMember.find({
      orgId: oid,
      classId: { $in: classIds },
      role: 'student',
      isActive: true,
    })
      .select('userId classId')
      .lean(),
    Enrollment.find({
      orgId: oid,
      academicClassId: { $in: classIds },
      isActive: true,
    })
      .select('studentId academicClassId')
      .lean(),
  ]);

  const map = new Map();
  const add = (studentId, classId) => {
    const sid = String(studentId);
    const cls = classById.get(String(classId));
    if (!cls) return;
    if (!map.has(sid)) map.set(sid, []);
    const list = map.get(sid);
    if (!list.some((c) => c.id === cls.id)) list.push(cls);
  };

  for (const m of studentMemberships) add(m.userId, m.classId);
  for (const e of enrollments) add(e.studentId, e.academicClassId);

  for (const list of map.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  return map;
}

/**
 * Students a teacher (or admin) may manage or assign assessments to.
 * Prefer class membership / enrollments; keep parentUserId as fallback for legacy data.
 */
export async function listAssignableStudents(models, actor, orgId) {
  const { User, ClassMember, Enrollment } = models;
  const oid = orgOid(orgId);

  if (actor.hierarchyRole === 'admin') {
    const students = await User.find({
      orgId: oid,
      hierarchyRole: 'user',
      isActive: { $ne: false },
    })
      .sort({ firstName: 1, lastName: 1, email: 1 })
      .lean();
    return students.map((u) => ({
      id: String(u._id),
      email: u.email,
      label: studentDisplayName(u),
      hierarchyRole: u.hierarchyRole,
    }));
  }

  if (actor.hierarchyRole === 'subordinate') {
    const teacherMemberships = await ClassMember.find({
      orgId: oid,
      userId: actor._id,
      role: 'teacher',
      isActive: true,
    })
      .select('classId')
      .lean();

    const classIds = teacherMemberships.map((m) => m.classId);
    const classStudentIds = new Set();

    if (classIds.length) {
      const [studentMemberships, enrollments] = await Promise.all([
        ClassMember.find({
          orgId: oid,
          classId: { $in: classIds },
          role: 'student',
          isActive: true,
        })
          .select('userId')
          .lean(),
        Enrollment.find({
          orgId: oid,
          academicClassId: { $in: classIds },
          isActive: true,
        })
          .select('studentId')
          .lean(),
      ]);
      for (const m of studentMemberships) {
        classStudentIds.add(String(m.userId));
      }
      for (const e of enrollments) {
        classStudentIds.add(String(e.studentId));
      }
    }

    const or = [{ parentUserId: actor._id }];
    if (classStudentIds.size) {
      or.push({ _id: { $in: [...classStudentIds] } });
    }

    const students = await User.find({
      orgId: oid,
      hierarchyRole: 'user',
      isActive: { $ne: false },
      $or: or,
    })
      .sort({ firstName: 1, lastName: 1, email: 1 })
      .lean();

    const classMap = await mapStudentClassesForTeacher(models, actor, orgId);

    return students.map((u) => ({
      id: String(u._id),
      email: u.email,
      label: studentDisplayName(u),
      hierarchyRole: u.hierarchyRole,
      classes: classMap.get(String(u._id)) || [],
    }));
  }

  const err = new Error('Forbidden');
  err.status = 403;
  throw err;
}

export async function allowedStudentIdSet(models, actor, orgId) {
  const assignees = await listAssignableStudents(models, actor, orgId);
  return new Set(assignees.map((a) => a.id));
}
