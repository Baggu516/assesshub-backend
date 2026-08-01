import mongoose from 'mongoose';
import { PERMISSION_KEYS } from '../../constants/permissions.js';
import { logActivity } from '../../utils/activity.js';
import { allowedStudentIdSet, listAssignableStudents } from '../shared/studentScope.service.js';
import { resolveGroupStudentIds } from '../student-group/student-group.service.js';

const ACTIVE = { deletedAt: null };

function orgOid(orgId) {
  return new mongoose.Types.ObjectId(String(orgId));
}

function serializeQuestion(q, { includeAnswers = true } = {}) {
  const base = {
    id: String(q._id),
    type: q.type,
    prompt: q.prompt,
    points: q.points,
    order: q.order,
    options: (q.options || []).map((o) => ({
      id: String(o._id),
      text: o.text,
      ...(includeAnswers ? { isCorrect: o.isCorrect } : {}),
    })),
  };
  if (includeAnswers && q.type === 'short_answer') {
    base.acceptedAnswers = q.acceptedAnswers || [];
    base.caseSensitive = q.caseSensitive ?? false;
  }
  return base;
}

function serializeAssessment(doc, opts = {}) {
  return {
    id: String(doc._id),
    title: doc.title,
    description: doc.description || '',
    status: doc.status,
    createdBy: doc.createdBy ? String(doc.createdBy) : null,
    questions: (doc.questions || [])
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((q) => serializeQuestion(q, opts)),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function serializeAssignment(doc, extras = {}) {
  return {
    id: String(doc._id),
    assessmentId: String(doc.assessmentId),
    studentId: String(doc.studentId),
    assignedBy: String(doc.assignedBy),
    dueDate: doc.dueDate,
    status: doc.status,
    submittedAt: doc.submittedAt,
    score: doc.score,
    maxScore: doc.maxScore,
    answers: doc.answers || [],
    createdAt: doc.createdAt,
    ...extras,
  };
}

function studentDisplayName(u) {
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return name || u.email;
}

function canCreateAssessment(actor) {
  return actor.permissions.includes(PERMISSION_KEYS.ASSESSMENT_CREATE);
}

function isStudent(actor) {
  return actor.hierarchyRole === 'user';
}

function normalizeShortAnswer(text, caseSensitive) {
  const trimmed = String(text || '').trim();
  if (caseSensitive) return trimmed;
  return trimmed.toLowerCase();
}

function gradeAnswer(question, answerInput) {
  const points = question.points ?? 1;

  if (question.type === 'single_select') {
    const correctId = (question.options || []).find((o) => o.isCorrect)?._id?.toString();
    const selected = answerInput.selectedOptionIds?.[0];
    const isCorrect = Boolean(correctId && selected && correctId === String(selected));
    return { isCorrect, pointsEarned: isCorrect ? points : 0 };
  }

  if (question.type === 'multi_select') {
    const correctIds = new Set(
      (question.options || []).filter((o) => o.isCorrect).map((o) => o._id.toString())
    );
    const selectedIds = new Set((answerInput.selectedOptionIds || []).map(String));
    const isCorrect =
      correctIds.size === selectedIds.size && [...correctIds].every((id) => selectedIds.has(id));
    return { isCorrect, pointsEarned: isCorrect ? points : 0 };
  }

  if (question.type === 'short_answer') {
    const normalized = normalizeShortAnswer(answerInput.textAnswer, question.caseSensitive);
    const accepted = (question.acceptedAnswers || []).map((a) =>
      normalizeShortAnswer(a, question.caseSensitive)
    );
    const isCorrect = accepted.includes(normalized);
    return { isCorrect, pointsEarned: isCorrect ? points : 0 };
  }

  return { isCorrect: false, pointsEarned: 0 };
}

/** Students a teacher (or admin) may assign assessments to. */
export async function listAssessmentAssignees(models, actor, orgId) {
  return listAssignableStudents(models, actor, orgId);
}

export async function createAssessment(models, actor, orgId, body, ip) {
  if (!canCreateAssessment(actor)) {
    const err = new Error('Missing permission: assessment_create');
    err.status = 403;
    throw err;
  }

  const { Assessment } = models;
  const doc = await Assessment.create({
    orgId: orgOid(orgId),
    title: body.title,
    description: body.description || '',
    status: 'draft',
    createdBy: actor._id,
    questions: body.questions.map((q, i) => ({
      type: q.type,
      prompt: q.prompt,
      points: q.points ?? 1,
      order: q.order ?? i,
      options: q.options || [],
      acceptedAnswers: q.acceptedAnswers || [],
      caseSensitive: q.caseSensitive ?? false,
    })),
  });

  await logActivity({
    models,
    orgId: orgOid(orgId),
    actorId: actor._id,
    action: 'assessment.created',
    resourceType: 'Assessment',
    resourceId: doc._id,
    metadata: { title: doc.title },
    ip,
  });

  return serializeAssessment(doc.toObject());
}

export async function listAssessments(models, actor, orgId, query) {
  const { Assessment } = models;
  const oid = orgOid(orgId);
  const { page = 1, limit = 20, status } = query;

  const filter = { orgId: oid, ...ACTIVE };
  if (status) filter.status = status;

  if (canCreateAssessment(actor) && !isStudent(actor)) {
    if (actor.hierarchyRole === 'subordinate') {
      filter.createdBy = actor._id;
    }
  } else if (isStudent(actor)) {
    const err = new Error('Students should use /assessments/assignments/my');
    err.status = 400;
    throw err;
  }

  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    Assessment.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
    Assessment.countDocuments(filter),
  ]);

  return {
    assessments: items.map((a) => serializeAssessment(a)),
    total,
    page,
    limit,
  };
}

export async function getAssessment(models, actor, orgId, assessmentId) {
  const { Assessment } = models;
  const doc = await Assessment.findOne({ _id: assessmentId, orgId: orgOid(orgId), ...ACTIVE }).lean();
  if (!doc) {
    const err = new Error('Assessment not found');
    err.status = 404;
    throw err;
  }

  const isOwner =
    canCreateAssessment(actor) &&
    (actor.hierarchyRole === 'admin' || doc.createdBy?.toString() === actor._id.toString());

  if (!isOwner && !actor.permissions.includes(PERMISSION_KEYS.ASSESSMENT_VIEW)) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }

  return serializeAssessment(doc, { includeAnswers: isOwner });
}

export async function updateAssessment(models, actor, orgId, assessmentId, body) {
  if (!canCreateAssessment(actor)) {
    const err = new Error('Missing permission: assessment_create');
    err.status = 403;
    throw err;
  }

  const { Assessment } = models;
  const doc = await Assessment.findOne({ _id: assessmentId, orgId: orgOid(orgId), ...ACTIVE });
  if (!doc) {
    const err = new Error('Assessment not found');
    err.status = 404;
    throw err;
  }

  if (actor.hierarchyRole === 'subordinate' && doc.createdBy?.toString() !== actor._id.toString()) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }

  if (doc.status !== 'draft') {
    const err = new Error('Only draft assessments can be edited');
    err.status = 400;
    throw err;
  }

  if (body.title !== undefined) doc.title = body.title;
  if (body.description !== undefined) doc.description = body.description;
  if (body.questions !== undefined) {
    doc.questions = body.questions.map((q, i) => ({
      type: q.type,
      prompt: q.prompt,
      points: q.points ?? 1,
      order: q.order ?? i,
      options: q.options || [],
      acceptedAnswers: q.acceptedAnswers || [],
      caseSensitive: q.caseSensitive ?? false,
    }));
  }

  await doc.save();
  return serializeAssessment(doc.toObject());
}

export async function publishAssessment(models, actor, orgId, assessmentId) {
  if (!canCreateAssessment(actor)) {
    const err = new Error('Missing permission: assessment_create');
    err.status = 403;
    throw err;
  }

  const { Assessment } = models;
  const doc = await Assessment.findOne({ _id: assessmentId, orgId: orgOid(orgId), ...ACTIVE });
  if (!doc) {
    const err = new Error('Assessment not found');
    err.status = 404;
    throw err;
  }

  if (actor.hierarchyRole === 'subordinate' && doc.createdBy?.toString() !== actor._id.toString()) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }

  if (!doc.questions?.length) {
    const err = new Error('Assessment must have at least one question');
    err.status = 400;
    throw err;
  }

  doc.status = 'published';
  await doc.save();
  return serializeAssessment(doc.toObject());
}

export async function assignAssessment(models, actor, orgId, assessmentId, body) {
  if (!canCreateAssessment(actor)) {
    const err = new Error('Missing permission: assessment_create');
    err.status = 403;
    throw err;
  }

  const { Assessment, AssessmentAssignment } = models;
  const oid = orgOid(orgId);

  const assessment = await Assessment.findOne({ _id: assessmentId, orgId: oid, ...ACTIVE });
  if (!assessment) {
    const err = new Error('Assessment not found');
    err.status = 404;
    throw err;
  }

  if (assessment.status !== 'published') {
    const err = new Error('Only published assessments can be assigned');
    err.status = 400;
    throw err;
  }

  if (actor.hierarchyRole === 'subordinate' && assessment.createdBy?.toString() !== actor._id.toString()) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }

  const allowed = await allowedStudentIdSet(models, actor, orgId);

  const fromGroups = body.groupIds?.length
    ? await resolveGroupStudentIds(models, actor, orgId, body.groupIds)
    : [];
  const studentIds = [...new Set([...(body.studentIds || []).map(String), ...fromGroups])];

  if (!studentIds.length) {
    const err = new Error('No students found in selected groups');
    err.status = 400;
    throw err;
  }

  for (const sid of studentIds) {
    if (!allowed.has(sid)) {
      const err = new Error(`Cannot assign to student: ${sid}`);
      err.status = 403;
      throw err;
    }
  }

  const maxScore = (assessment.questions || []).reduce((sum, q) => sum + (q.points ?? 1), 0);
  const created = [];

  for (const studentId of studentIds) {
    const assignment = await AssessmentAssignment.findOneAndUpdate(
      { orgId: oid, assessmentId: assessment._id, studentId },
      {
        $setOnInsert: {
          orgId: oid,
          assessmentId: assessment._id,
          studentId: new mongoose.Types.ObjectId(studentId),
          assignedBy: actor._id,
          dueDate: body.dueDate || null,
          status: 'pending',
          maxScore,
          score: 0,
          answers: [],
        },
      },
      { upsert: true, new: true }
    );
    created.push(serializeAssignment(assignment.toObject()));
  }

  return { assignments: created };
}

export async function listMyAssignments(models, actor, orgId) {
  const { AssessmentAssignment, Assessment, User } = models;
  const oid = orgOid(orgId);

  if (!actor.permissions.includes(PERMISSION_KEYS.ASSESSMENT_VIEW)) {
    const err = new Error('Missing permission: assessment_view');
    err.status = 403;
    throw err;
  }

  const filter =
    actor.hierarchyRole === 'user'
      ? { orgId: oid, studentId: actor._id }
      : canCreateAssessment(actor)
        ? { orgId: oid, assignedBy: actor._id }
        : { orgId: oid, studentId: actor._id };

  const assignments = await AssessmentAssignment.find(filter).sort({ createdAt: -1 }).lean();
  const assessmentIds = [...new Set(assignments.map((a) => String(a.assessmentId)))];
  const assessments = await Assessment.find({ _id: { $in: assessmentIds }, ...ACTIVE }).lean();
  const assessmentMap = new Map(assessments.map((a) => [String(a._id), a]));

  const studentIds = [...new Set(assignments.map((a) => String(a.studentId)))];
  const students = await User.find({ _id: { $in: studentIds } }).lean();
  const studentMap = new Map(students.map((s) => [String(s._id), s]));

  return {
    assignments: assignments.map((a) => {
      const assessment = assessmentMap.get(String(a.assessmentId));
      const student = studentMap.get(String(a.studentId));
      return serializeAssignment(a, {
        assessmentTitle: assessment?.title || 'Unknown',
        assessmentStatus: assessment?.status,
        studentLabel: student ? studentDisplayName(student) : 'Unknown',
      });
    }),
  };
}

export async function getAssignment(models, actor, orgId, assignmentId) {
  const { AssessmentAssignment, Assessment } = models;
  const oid = orgOid(orgId);

  const assignment = await AssessmentAssignment.findOne({ _id: assignmentId, orgId: oid }).lean();
  if (!assignment) {
    const err = new Error('Assignment not found');
    err.status = 404;
    throw err;
  }

  const isStudentOwner = assignment.studentId?.toString() === actor._id.toString();
  const isTeacher =
    canCreateAssessment(actor) &&
    (actor.hierarchyRole === 'admin' || assignment.assignedBy?.toString() === actor._id.toString());

  if (!isStudentOwner && !isTeacher) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }

  const assessment = await Assessment.findOne({
    _id: assignment.assessmentId,
    orgId: oid,
    ...ACTIVE,
  }).lean();

  if (!assessment || assessment.status !== 'published') {
    const err = new Error('Assessment not available');
    err.status = 400;
    throw err;
  }

  const includeAnswers = isTeacher || assignment.status === 'submitted';
  const serializedAssessment = serializeAssessment(assessment, { includeAnswers });

  if (isStudentOwner && assignment.status === 'pending') {
    for (const q of serializedAssessment.questions) {
      delete q.acceptedAnswers;
      delete q.caseSensitive;
    }
  }

  return {
    assignment: serializeAssignment(assignment),
    assessment: serializedAssessment,
  };
}

export async function submitAssignment(models, actor, orgId, assignmentId, body) {
  if (!actor.permissions.includes(PERMISSION_KEYS.ASSESSMENT_SUBMIT)) {
    const err = new Error('Missing permission: assessment_submit');
    err.status = 403;
    throw err;
  }

  const { AssessmentAssignment, Assessment } = models;
  const oid = orgOid(orgId);

  const assignment = await AssessmentAssignment.findOne({ _id: assignmentId, orgId: oid });
  if (!assignment) {
    const err = new Error('Assignment not found');
    err.status = 404;
    throw err;
  }

  if (assignment.studentId?.toString() !== actor._id.toString()) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }

  if (assignment.status === 'submitted') {
    const err = new Error('Assessment already submitted');
    err.status = 400;
    throw err;
  }

  const assessment = await Assessment.findOne({
    _id: assignment.assessmentId,
    orgId: oid,
    status: 'published',
    ...ACTIVE,
  }).lean();

  if (!assessment) {
    const err = new Error('Assessment not available');
    err.status = 400;
    throw err;
  }

  const questionMap = new Map((assessment.questions || []).map((q) => [q._id.toString(), q]));
  const answeredIds = new Set(body.answers.map((a) => String(a.questionId)));

  for (const q of assessment.questions || []) {
    if (!answeredIds.has(q._id.toString())) {
      const err = new Error('All questions must be answered');
      err.status = 400;
      throw err;
    }
  }

  let totalScore = 0;
  const gradedAnswers = body.answers.map((input) => {
    const question = questionMap.get(String(input.questionId));
    if (!question) {
      const err = new Error(`Invalid questionId: ${input.questionId}`);
      err.status = 400;
      throw err;
    }

    if (question.type === 'short_answer') {
      const words = (input.textAnswer || '').trim().split(/\s+/).filter(Boolean);
      if (words.length > 2) {
        const err = new Error('Short answer must be 1–2 words');
        err.status = 400;
        throw err;
      }
    }

    const { isCorrect, pointsEarned } = gradeAnswer(question, input);
    totalScore += pointsEarned;

    return {
      questionId: question._id,
      selectedOptionIds: (input.selectedOptionIds || []).map((id) => new mongoose.Types.ObjectId(id)),
      textAnswer: input.textAnswer || '',
      isCorrect,
      pointsEarned,
    };
  });

  assignment.answers = gradedAnswers;
  assignment.score = totalScore;
  assignment.maxScore = (assessment.questions || []).reduce((sum, q) => sum + (q.points ?? 1), 0);
  assignment.status = 'submitted';
  assignment.submittedAt = new Date();
  await assignment.save();

  return {
    assignment: serializeAssignment(assignment.toObject()),
    assessment: serializeAssessment(assessment, { includeAnswers: true }),
  };
}

export async function getAssessmentResults(models, actor, orgId, assessmentId) {
  if (!canCreateAssessment(actor)) {
    const err = new Error('Missing permission: assessment_create');
    err.status = 403;
    throw err;
  }

  const { Assessment, AssessmentAssignment, User } = models;
  const oid = orgOid(orgId);

  const assessment = await Assessment.findOne({ _id: assessmentId, orgId: oid, ...ACTIVE }).lean();
  if (!assessment) {
    const err = new Error('Assessment not found');
    err.status = 404;
    throw err;
  }

  if (actor.hierarchyRole === 'subordinate' && assessment.createdBy?.toString() !== actor._id.toString()) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }

  const assignments = await AssessmentAssignment.find({ orgId: oid, assessmentId }).sort({ createdAt: -1 }).lean();
  const studentIds = assignments.map((a) => a.studentId);
  const students = await User.find({ _id: { $in: studentIds } }).lean();
  const studentMap = new Map(students.map((s) => [String(s._id), s]));

  return {
    assessment: serializeAssessment(assessment),
    results: assignments.map((a) => {
      const student = studentMap.get(String(a.studentId));
      return serializeAssignment(a, {
        studentLabel: student ? studentDisplayName(student) : 'Unknown',
        studentEmail: student?.email,
      });
    }),
  };
}
