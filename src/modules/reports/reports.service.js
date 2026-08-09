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
    const [totalAssessments, publishedDocs] = await Promise.all([
      Assessment.countDocuments(assessmentFilter),
      Assessment.find({ ...assessmentFilter, status: 'published' }).select('_id').lean(),
    ]);
    const publishedAssessments = publishedDocs.length;
    const publishedIds = publishedDocs.map((a) => a._id);

    let completedAssessments = 0;
    if (publishedIds.length) {
      const rows = await AssessmentAssignment.aggregate([
        {
          $match: {
            orgId: new mongoose.Types.ObjectId(String(orgId)),
            assignedBy: new mongoose.Types.ObjectId(String(actor._id)),
            assessmentId: { $in: publishedIds },
            ...yearClause,
          },
        },
        {
          $group: {
            _id: '$assessmentId',
            total: { $sum: 1 },
            submitted: {
              $sum: { $cond: [{ $eq: ['$status', 'submitted'] }, 1, 0] },
            },
          },
        },
      ]);
      completedAssessments = rows.filter((r) => r.total > 0 && r.submitted === r.total).length;
    }

    return {
      scope: 'teacher',
      academicYear: yearMeta,
      totalAssessments,
      publishedAssessments,
      completedAssessments,
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

/**
 * Richer assignment/submission context for the dashboard AI (trends + per-assessment).
 * Scoped to the actor: teacher = their assigns; admin = org-wide; student = their own.
 * Uses the same academic-year filter as the dashboard so counts match the UI.
 */
export async function aiWorkloadSnapshot(models, actor, orgId) {
  const { Assessment, AssessmentAssignment, User } = models;
  const oid = new mongoose.Types.ObjectId(String(orgId));
  const { clause: yearClause, year } = await resolveYearFilter(models, orgId, 'current');
  const dashboard = await dashboardForActor(models, actor, orgId, { academicYearId: 'current' });
  const isAdmin = actor.hierarchyRole === 'admin';
  const isStudent = actor.hierarchyRole === 'user';

  const now = new Date();
  const weeksBack = 6;
  const since = new Date(now);
  since.setDate(since.getDate() - weeksBack * 7);
  since.setHours(0, 0, 0, 0);

  const baseMatch = { orgId: oid, ...yearClause };
  if (actor.hierarchyRole === 'subordinate') {
    baseMatch.assignedBy = new mongoose.Types.ObjectId(String(actor._id));
  } else if (isStudent) {
    baseMatch.studentId = new mongoose.Types.ObjectId(String(actor._id));
  }

  const assignmentLimit = isStudent ? 100 : 80;

  const assessmentListFilter = { orgId: oid, ...ACTIVE_ASSESSMENT };
  if (actor.hierarchyRole === 'subordinate') {
    assessmentListFilter.createdBy = actor._id;
  }

  const [statusCounts, weeklySubmitted, assignmentRows, ownedAssessments, teacherAgg] =
    await Promise.all([
      AssessmentAssignment.aggregate([
        { $match: baseMatch },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      AssessmentAssignment.aggregate([
        {
          $match: {
            ...baseMatch,
            status: 'submitted',
            submittedAt: { $gte: since },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$submittedAt' },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      AssessmentAssignment.find(baseMatch)
        .select(
          isStudent
            ? 'assessmentId status score maxScore submittedAt dueDate answers'
            : 'assessmentId assignedBy status score maxScore submittedAt dueDate'
        )
        .sort({ submittedAt: -1, updatedAt: -1 })
        .limit(assignmentLimit)
        .lean(),
      isStudent
        ? Promise.resolve([])
        : Assessment.find(assessmentListFilter)
            .select('title status createdAt createdBy')
            .sort({ updatedAt: -1 })
            .limit(40)
            .lean(),
      isAdmin
        ? AssessmentAssignment.aggregate([
            { $match: baseMatch },
            {
              $group: {
                _id: '$assignedBy',
                pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
                submitted: { $sum: { $cond: [{ $eq: ['$status', 'submitted'] }, 1, 0] } },
                assigned: { $sum: 1 },
                avgScorePercent: {
                  $avg: {
                    $cond: [
                      {
                        $and: [
                          { $eq: ['$status', 'submitted'] },
                          { $gt: ['$maxScore', 0] },
                        ],
                      },
                      { $multiply: [{ $divide: ['$score', '$maxScore'] }, 100] },
                      null,
                    ],
                  },
                },
              },
            },
            { $sort: { pending: -1, submitted: -1 } },
            { $limit: 30 },
          ])
        : Promise.resolve([]),
    ]);

  // Accurate org/teacher/student totals (not capped by assignmentLimit).
  const pending = statusCounts.find((r) => r._id === 'pending')?.count || 0;
  const submitted = statusCounts.find((r) => r._id === 'submitted')?.count || 0;

  let byTeacher = [];
  if (isAdmin && teacherAgg.length) {
    const teacherIds = teacherAgg.map((t) => t._id).filter(Boolean);
    const teachers = teacherIds.length
      ? await User.find({ _id: { $in: teacherIds } }).select('firstName lastName email').lean()
      : [];
    const teacherMap = new Map(teachers.map((u) => [String(u._id), u]));
    byTeacher = teacherAgg.map((t) => {
      const u = teacherMap.get(String(t._id));
      const name = u
        ? [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email
        : 'Teacher';
      const avg =
        typeof t.avgScorePercent === 'number' && !Number.isNaN(t.avgScorePercent)
          ? Math.round(t.avgScorePercent)
          : null;
      return {
        teacherId: String(t._id),
        teacherName: name,
        pending: t.pending,
        completed: t.submitted,
        assigned: t.assigned,
        avgScorePercent: avg,
      };
    });
  }

  const weeklyBuckets = new Map();
  for (const row of weeklySubmitted) {
    const d = new Date(`${row._id}T00:00:00Z`);
    const weekStart = new Date(d);
    weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
    const key = weekStart.toISOString().slice(0, 10);
    weeklyBuckets.set(key, (weeklyBuckets.get(key) || 0) + row.count);
  }
  const submissionsByWeek = [...weeklyBuckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([weekStarting, count]) => ({ weekStarting, count }));

  const assessmentIds = [
    ...new Set([
      ...assignmentRows.map((r) => String(r.assessmentId)),
      ...ownedAssessments.map((a) => String(a._id)),
    ]),
  ]
    .filter(Boolean)
    .map((id) => new mongoose.Types.ObjectId(id));

  const assessments = assessmentIds.length
    ? await Assessment.find({ _id: { $in: assessmentIds } })
        .select(
          isStudent
            ? 'title status createdAt questions._id questions.prompt questions.points questions.order questions.type'
            : 'title status createdAt'
        )
        .lean()
    : [];
  const titleById = new Map(assessments.map((a) => [String(a._id), a]));

  function missedQuestionsForAssignment(assignmentDoc) {
    if (!isStudent || assignmentDoc.status !== 'submitted') return [];
    const assessment = titleById.get(String(assignmentDoc.assessmentId));
    const qById = new Map((assessment?.questions || []).map((q) => [String(q._id), q]));
    const missed = [];
    for (const ans of assignmentDoc.answers || []) {
      if (ans.isCorrect) continue;
      const q = qById.get(String(ans.questionId));
      if (!q) continue;
      const prompt = String(q.prompt || '').trim().slice(0, 220);
      if (!prompt) continue;
      missed.push({
        questionOrder: typeof q.order === 'number' ? q.order + 1 : null,
        prompt,
        pointsPossible: q.points ?? 1,
        pointsEarned: ans.pointsEarned ?? 0,
      });
    }
    return missed.slice(0, 10);
  }

  const byAssessmentMap = new Map();
  for (const r of assignmentRows) {
    const id = String(r.assessmentId);
    if (!byAssessmentMap.has(id)) {
      byAssessmentMap.set(id, {
        assessmentId: id,
        title: titleById.get(id)?.title || 'Assessment',
        publicationStatus: titleById.get(id)?.status || null,
        assigned: 0,
        pending: 0,
        submitted: 0,
        scoreSum: 0,
        scoreCount: 0,
      });
    }
    const row = byAssessmentMap.get(id);
    row.assigned += 1;
    if (r.status === 'pending') row.pending += 1;
    if (r.status === 'submitted') {
      row.submitted += 1;
      if (r.maxScore > 0) {
        row.scoreSum += (r.score / r.maxScore) * 100;
        row.scoreCount += 1;
      }
    }
  }

  const perAssessment = [...byAssessmentMap.values()].map((r) => ({
    assessmentId: r.assessmentId,
    title: r.title,
    publicationStatus: r.publicationStatus,
    assigned: r.assigned,
    pending: r.pending,
    submitted: r.submitted,
    avgScorePercent: r.scoreCount ? Math.round(r.scoreSum / r.scoreCount) : null,
  }));

  const assignments = assignmentRows.map((r) => {
    const a = titleById.get(String(r.assessmentId));
    const score = typeof r.score === 'number' ? r.score : 0;
    const maxScore = typeof r.maxScore === 'number' ? r.maxScore : 0;
    const scorePercent = maxScore > 0 ? Math.round((score / maxScore) * 100) : null;
    const incorrectQuestions = missedQuestionsForAssignment(r);
    return {
      assessmentId: String(r.assessmentId),
      title: a?.title || 'Assessment',
      assignmentStatus: r.status,
      publicationStatus: a?.status || null,
      score,
      maxScore,
      scorePercent,
      scoreIsLow: scorePercent != null && scorePercent < 70,
      submittedAt: r.submittedAt || null,
      dueDate: r.dueDate || null,
      incorrectQuestions,
    };
  });

  const allAssessments = isStudent
    ? assignments.map((row) => ({
        assessmentId: row.assessmentId,
        title: row.title,
        assignmentStatus: row.assignmentStatus,
        publicationStatus: row.publicationStatus,
        score: row.score,
        maxScore: row.maxScore,
        scorePercent: row.scorePercent,
        scoreIsLow: row.scoreIsLow,
        dueDate: row.dueDate,
        submittedAt: row.submittedAt,
        incorrectQuestionCount: row.incorrectQuestions.length,
      }))
    : (ownedAssessments.length ? ownedAssessments : assessments).map((a) => ({
        assessmentId: String(a._id),
        title: a.title || 'Assessment',
        publicationStatus: a.status || null,
        createdAt: a.createdAt || null,
      }));

  const pendingItems = assignments
    .filter((a) => a.assignmentStatus === 'pending')
    .map((a) => ({ title: a.title, dueDate: a.dueDate }));
  const submittedItems = assignments
    .filter((a) => a.assignmentStatus === 'submitted')
    .map((a) => ({
      title: a.title,
      score: a.score,
      maxScore: a.maxScore,
      scorePercent: a.scorePercent,
      scoreIsLow: a.scoreIsLow,
      submittedAt: a.submittedAt,
      incorrectQuestions: isStudent ? a.incorrectQuestions : undefined,
    }));

  const reviewPlan = isStudent
    ? submittedItems
        .filter((a) => a.scoreIsLow || (a.incorrectQuestions && a.incorrectQuestions.length))
        .map((a) => ({
          assessmentTitle: a.title,
          scorePercent: a.scorePercent,
          action:
            'Reopen this assessment result, review each incorrect question, then study that topic before your next attempt or related work.',
          incorrectQuestions: a.incorrectQuestions,
        }))
    : [];

  const teachersNeedingFollowUp = byTeacher
    .filter((t) => t.pending > 0)
    .slice(0, 5)
    .map((t) => ({
      teacherName: t.teacherName,
      pending: t.pending,
      completed: t.completed,
    }));

  return {
    role: actor.hierarchyRole,
    academicYear: year
      ? { id: String(year._id), label: year.label, isCurrent: !!year.isCurrent }
      : null,
    summary: {
      pendingCount: pending,
      submittedCount: submitted,
      assignedCount: pending + submitted,
      pendingItems: isAdmin ? undefined : pendingItems,
      submittedItems: isAdmin ? undefined : submittedItems,
      reviewPlan: reviewPlan.length ? reviewPlan : undefined,
      byTeacher,
      teachersNeedingFollowUp,
      note: isAdmin
        ? 'For org/admin questions: list each summary.byTeacher as “Under {teacherName}: {completed} completed, {pending} pending”. Then end with one overall suggestion (e.g. follow up with teachersNeedingFollowUp). completed = submitted turn-ins; pending = not turned in. Do not say submitted work is pending. If byTeacher is empty, say there are no assignments in the current academic year.'
        : 'pendingCount is assignments not yet turned in. publicationStatus "published" does NOT mean pending. When scoreIsLow or reviewPlan is present, coach the student to review incorrectQuestions and study those topics.',
    },
    dashboard,
    submissionActivity: {
      windowWeeks: weeksBack,
      totals: { pending, submitted, assigned: pending + submitted },
      submissionsByWeek,
      perAssessment,
      assignments: isAdmin ? undefined : assignments,
      allAssessments,
      byTeacher: isAdmin ? byTeacher : undefined,
    },
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

