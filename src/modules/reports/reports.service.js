import mongoose from 'mongoose';

const ACTIVE_ASSESSMENT = { deletedAt: null };
const ACTIVE_YEAR = { deletedAt: null };

async function resolveYearFilter(models, orgId, academicYearIdParam) {
  if (academicYearIdParam === 'all') {
    return { clause: {}, year: null };
  }

  const { AcademicYear } = models;
  const oid = new mongoose.Types.ObjectId(String(orgId));

  let year = null;
  if (academicYearIdParam && academicYearIdParam !== 'current') {
    year = await AcademicYear.findOne({ _id: academicYearIdParam, orgId: oid, ...ACTIVE_YEAR }).lean();
  } else {
    year = await AcademicYear.findOne({ orgId: oid, isCurrent: true, ...ACTIVE_YEAR }).lean();
    if (!year) {
      year = await AcademicYear.findOne({ orgId: oid, ...ACTIVE_YEAR }).sort({ label: -1 }).lean();
    }
  }

  if (!year) {
    return { clause: {}, year: null };
  }

  if (year.isCurrent) {
    return {
      clause: {
        $or: [
          { academicYearId: year._id },
          { academicYearId: null },
          { academicYearId: { $exists: false } },
        ],
      },
      year,
    };
  }

  return { clause: { academicYearId: year._id }, year };
}

export async function dashboardForActor(models, actor, orgId, query = {}) {
  const { User, Assessment, AssessmentAssignment } = models;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const { clause: yearClause, year } = await resolveYearFilter(models, orgId, query.academicYearId);
  const yearMeta = year ? { id: String(year._id), label: year.label, isCurrent: !!year.isCurrent } : null;

  if (actor.hierarchyRole === 'admin') {
    const [totalTeachers, totalStudents, totalAssessments, publishedAssessments, submissionsThisMonth] =
      await Promise.all([
        User.countDocuments({ orgId, hierarchyRole: 'subordinate', isActive: { $ne: false } }),
        User.countDocuments({ orgId, hierarchyRole: 'user', isActive: { $ne: false } }),
        Assessment.countDocuments({ orgId, ...ACTIVE_ASSESSMENT }),
        Assessment.countDocuments({ orgId, status: 'published', ...ACTIVE_ASSESSMENT }),
        AssessmentAssignment.countDocuments({
          orgId,
          status: 'submitted',
          submittedAt: { $gte: startOfMonth },
          ...yearClause,
        }),
      ]);

    return {
      scope: 'organization',
      academicYear: yearMeta,
      totalTeachers,
      totalStudents,
      totalAssessments,
      publishedAssessments,
      submissionsThisMonth,
    };
  }

  if (actor.hierarchyRole === 'subordinate') {
    const assessmentFilter = { orgId, createdBy: actor._id, ...ACTIVE_ASSESSMENT };
    const assignmentBase = { orgId, assignedBy: actor._id, ...yearClause };
    const [totalAssessments, publishedAssessments, pendingSubmissions, completedSubmissions] =
      await Promise.all([
        Assessment.countDocuments(assessmentFilter),
        Assessment.countDocuments({ ...assessmentFilter, status: 'published' }),
        AssessmentAssignment.countDocuments({ ...assignmentBase, status: 'pending' }),
        AssessmentAssignment.countDocuments({ ...assignmentBase, status: 'submitted' }),
      ]);

    return {
      scope: 'teacher',
      academicYear: yearMeta,
      totalAssessments,
      publishedAssessments,
      pendingSubmissions,
      completedSubmissions,
    };
  }

  const mine = { orgId, studentId: actor._id, ...yearClause };
  const [assigned, pending, submitted, submittedDocs] = await Promise.all([
    AssessmentAssignment.countDocuments(mine),
    AssessmentAssignment.countDocuments({ ...mine, status: 'pending' }),
    AssessmentAssignment.countDocuments({ ...mine, status: 'submitted' }),
    AssessmentAssignment.find({ ...mine, status: 'submitted' }).select('score maxScore').lean(),
  ]);

  let averageScorePercent = 0;
  if (submittedDocs.length) {
    const sum = submittedDocs.reduce((acc, a) => {
      if (!a.maxScore) return acc;
      return acc + (a.score / a.maxScore) * 100;
    }, 0);
    averageScorePercent = Math.round(sum / submittedDocs.length);
  }

  return {
    scope: 'student',
    academicYear: yearMeta,
    assignedAssessments: assigned,
    pendingAssessments: pending,
    submittedAssessments: submitted,
    averageScorePercent,
  };
}

export async function activityFeed(models, orgId, { page = 1, limit = 30 }) {
  const { ActivityLog, User } = models;
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    ActivityLog.find({ orgId }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ActivityLog.countDocuments({ orgId }),
  ]);

  const actorIds = [...new Set(items.map((i) => String(i.actorId)).filter(Boolean))];
  const actors = actorIds.length
    ? await User.find({ _id: { $in: actorIds } }).select('firstName lastName email').lean()
    : [];
  const actorMap = new Map(actors.map((u) => [String(u._id), u]));

  return {
    items: items.map((i) => {
      const actor = actorMap.get(String(i.actorId));
      const actorName = actor
        ? [actor.firstName, actor.lastName].filter(Boolean).join(' ').trim() || actor.email
        : null;
      return {
        id: String(i._id),
        action: i.action,
        resourceType: i.resourceType || null,
        resourceId: i.resourceId ? String(i.resourceId) : null,
        metadata: i.metadata || null,
        ip: i.ip || null,
        actorId: i.actorId ? String(i.actorId) : null,
        actorLabel: actorName,
        createdAt: i.createdAt,
      };
    }),
    total,
    page,
    limit,
  };
}
