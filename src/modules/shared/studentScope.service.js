import mongoose from 'mongoose';

function orgOid(orgId) {
  return new mongoose.Types.ObjectId(String(orgId));
}

function studentDisplayName(u) {
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return name || u.email;
}

/**
 * Students a teacher (or admin) may manage or assign assessments to.
 * Prefer class membership; keep parentUserId as fallback for legacy data.
 */
export async function listAssignableStudents(models, actor, orgId) {
  const { User, ClassMember } = models;
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
      const studentMemberships = await ClassMember.find({
        orgId: oid,
        classId: { $in: classIds },
        role: 'student',
        isActive: true,
      })
        .select('userId')
        .lean();
      for (const m of studentMemberships) {
        classStudentIds.add(String(m.userId));
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

    return students.map((u) => ({
      id: String(u._id),
      email: u.email,
      label: studentDisplayName(u),
      hierarchyRole: u.hierarchyRole,
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
