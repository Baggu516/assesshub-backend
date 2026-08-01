const ACTIVE_ASSESSMENT = { deletedAt: null };

export async function dashboardForActor(models, actor, orgId) {
  const { User, Assessment, AssessmentAssignment } = models;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

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
        }),
      ]);

    return {
      scope: 'organization',
      totalTeachers,
      totalStudents,
      totalAssessments,
      publishedAssessments,
      submissionsThisMonth,
    };
  }

  if (actor.hierarchyRole === 'subordinate') {
    const assessmentFilter = { orgId, createdBy: actor._id, ...ACTIVE_ASSESSMENT };
    const [totalAssessments, publishedAssessments, pendingSubmissions, completedSubmissions] = await Promise.all([
      Assessment.countDocuments(assessmentFilter),
      Assessment.countDocuments({ ...assessmentFilter, status: 'published' }),
      AssessmentAssignment.countDocuments({ orgId, assignedBy: actor._id, status: 'pending' }),
      AssessmentAssignment.countDocuments({ orgId, assignedBy: actor._id, status: 'submitted' }),
    ]);

    return {
      scope: 'teacher',
      totalAssessments,
      publishedAssessments,
      pendingSubmissions,
      completedSubmissions,
    };
  }

  const mine = { orgId, studentId: actor._id };
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
