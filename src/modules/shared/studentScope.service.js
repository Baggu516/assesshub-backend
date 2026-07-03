import mongoose from 'mongoose';

function orgOid(orgId) {
  return new mongoose.Types.ObjectId(String(orgId));
}

function studentDisplayName(u) {
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return name || u.email;
}

/** Students a teacher (or admin) may manage or assign assessments to. */
export async function listAssignableStudents(models, actor, orgId) {
  const { User } = models;
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
    const students = await User.find({
      orgId: oid,
      parentUserId: actor._id,
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

  const err = new Error('Forbidden');
  err.status = 403;
  throw err;
}

export async function allowedStudentIdSet(models, actor, orgId) {
  const assignees = await listAssignableStudents(models, actor, orgId);
  return new Set(assignees.map((a) => a.id));
}
