import mongoose from 'mongoose';
import { PERMISSION_KEYS } from '../../constants/permissions.js';
import { logActivity } from '../../utils/activity.js';
import { allowedStudentIdSet, listAssignableStudents } from '../shared/studentScope.service.js';
import {
  resolveGroupsForAssign,
  listStudentGroups,
} from '../student-group/student-group.service.js';
import {
  areAttemptResultsVisible,
  countPendingReleaseAttempts,
  pendingReleaseAttempts,
} from '../../utils/resultsRelease.js';
import { sendAssessmentResultsReleasedEmail } from '../../utils/mailer.js';
import { Organization } from '../../models/Organization.js';
import { deleteS3Object, downloadS3ToBuffer, s3Configured, uploadBufferToS3 } from '../../utils/s3.js';
import { normalizeOrgFeatures } from '../../middleware/plan.middleware.js';

const ACTIVE = { deletedAt: null };
export const MAX_FULLSCREEN_EXITS = 3;

/** Documents created before `kind` existed are the CBT flow, now called online exams. */
export function storedExamKind(doc) {
  return doc?.kind === 'assessment' ? 'assessment' : 'online_exam';
}

async function loadOrgFeatures(orgId) {
  const org = await Organization.findById(orgId).select('features plan subdomain').lean();
  return normalizeOrgFeatures(org);
}

async function assertExamKindAllowed(orgId, kind) {
  const features = await loadOrgFeatures(orgId);
  const allowed = kind === 'assessment' ? features.assessments : features.onlineExams;
  if (!allowed) {
    const err = new Error(
      kind === 'assessment'
        ? 'Assessments are not included in this organization plan.'
        : 'Online exams are not included in this organization plan.'
    );
    err.status = 403;
    throw err;
  }
}

function kindMongoFilter(kind) {
  if (kind === 'assessment') return { kind: 'assessment' };
  return { $or: [{ kind: 'online_exam' }, { kind: { $exists: false } }, { kind: null }] };
}

function orgOid(orgId) {
  return new mongoose.Types.ObjectId(String(orgId));
}

function hashString(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Stable per student and question, so a refresh does not reshuffle mid-attempt. */
function shuffleWithSeed(items, seedKey) {
  const arr = items.slice();
  let state = hashString(seedKey) || 1;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    const swap = arr[i];
    arr[i] = arr[j];
    arr[j] = swap;
  }
  return arr;
}

function serializeQuestion(q, { includeAnswers = true } = {}) {
  const base = {
    id: String(q._id),
    type: q.type,
    prompt: q.prompt,
    points: q.points,
    order: q.order,
    section: q.section || 'Section A',
    explanation: q.explanation || '',
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
    durationMinutes: doc.durationMinutes ?? 60,
    startAt: doc.startAt || null,
    endAt: doc.endAt || null,
    negativeMarkPerWrong: doc.negativeMarkPerWrong ?? 0,
    allowPartialCredit: doc.allowPartialCredit !== false,
    showAnswersAfterSubmit: doc.showAnswersAfterSubmit !== false,
    cameraMonitor: storedExamKind(doc) === 'online_exam' && doc.cameraMonitor === true,
    sections: Array.isArray(doc.sections) && doc.sections.length ? doc.sections : ['Section A'],
    kind: storedExamKind(doc),
    status: doc.status,
    resultsReleased: Boolean(doc.resultsReleased),
    resultsReleasedAt: doc.resultsReleasedAt || null,
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
    academicYearId: doc.academicYearId ? String(doc.academicYearId) : null,
    dueDate: doc.dueDate,
    status: doc.status,
    startedAt: doc.startedAt || null,
    expiresAt: doc.expiresAt || null,
    submitReason: doc.submitReason || null,
    fullscreenExitCount: doc.fullscreenExitCount || 0,
    maxFullscreenExits: MAX_FULLSCREEN_EXITS,
    submittedAt: doc.submittedAt,
    resultsHidden: Boolean(doc.resultsHidden),
    score: doc.score,
    maxScore: doc.maxScore,
    answers: doc.answers || [],
    createdAt: doc.createdAt,
    ...extras,
  };
}

/**
 * Resolve academic year for assign/filter. Prefer explicit id, else current, else newest label.
 */
async function resolveAcademicYear(models, orgId, academicYearId) {
  const { AcademicYear } = models;
  const oid = orgOid(orgId);

  if (academicYearId) {
    const year = await AcademicYear.findOne({ _id: academicYearId, orgId: oid, ...ACTIVE }).lean();
    if (!year) {
      const err = new Error('Academic year not found');
      err.status = 404;
      throw err;
    }
    return year;
  }

  const current = await AcademicYear.findOne({ orgId: oid, isCurrent: true, ...ACTIVE }).lean();
  if (current) return current;

  return AcademicYear.findOne({ orgId: oid, ...ACTIVE }).sort({ label: -1 }).lean();
}

/**
 * Build Mongo filter for academicYearId query param.
 * - missing / empty → current year (legacy nulls included when that year is current)
 * - "all" → no year filter
 * - specific id → that year only
 */
async function academicYearAssignmentFilter(models, orgId, academicYearIdParam) {
  if (academicYearIdParam === 'all') {
    return { filter: {}, year: null };
  }

  const year = await resolveAcademicYear(
    models,
    orgId,
    academicYearIdParam && academicYearIdParam !== 'current' ? academicYearIdParam : undefined
  );

  if (!year) {
    return { filter: {}, year: null };
  }

  const yearOid = year._id;
  // Legacy assignments (no year) stay visible under the current year so nothing "disappears"
  if (year.isCurrent) {
    return {
      filter: {
        $or: [{ academicYearId: yearOid }, { academicYearId: null }, { academicYearId: { $exists: false } }],
      },
      year,
    };
  }

  return { filter: { academicYearId: yearOid }, year };
}

function studentDisplayName(u) {
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return name || u.email;
}

function permissionForKind(kind, action) {
  const online = kind !== 'assessment';
  if (action === 'create') {
    return online ? PERMISSION_KEYS.ONLINE_EXAM_CREATE : PERMISSION_KEYS.ASSESSMENT_CREATE;
  }
  if (action === 'submit') {
    return online ? PERMISSION_KEYS.ONLINE_EXAM_SUBMIT : PERMISSION_KEYS.ASSESSMENT_SUBMIT;
  }
  return online ? PERMISSION_KEYS.ONLINE_EXAM_VIEW : PERMISSION_KEYS.ASSESSMENT_VIEW;
}

function assertKindPermission(actor, kind, action) {
  const key = permissionForKind(kind, action);
  if (!actor.permissions?.includes(key)) {
    const err = new Error('Forbidden: missing required permission');
    err.status = 403;
    throw err;
  }
}

function canCreateAssessment(actor) {
  return (
    actor.permissions.includes(PERMISSION_KEYS.ASSESSMENT_CREATE) ||
    actor.permissions.includes(PERMISSION_KEYS.ONLINE_EXAM_CREATE)
  );
}

function isStudent(actor) {
  return actor.hierarchyRole === 'user';
}

function normalizeShortAnswer(text, caseSensitive) {
  const trimmed = String(text || '').trim();
  if (caseSensitive) return trimmed;
  return trimmed.toLowerCase();
}

function gradeAnswer(question, answerInput, assessment = {}) {
  const points = question.points ?? 1;
  const negative = Number(assessment.negativeMarkPerWrong) || 0;
  const allowPartial = assessment.allowPartialCredit !== false;

  const hasResponse =
    (answerInput.selectedOptionIds || []).length > 0 ||
    String(answerInput.textAnswer || '').trim().length > 0;

  if (question.type === 'single_select') {
    if (!hasResponse) return { isCorrect: false, pointsEarned: 0 };
    const correctId = (question.options || []).find((o) => o.isCorrect)?._id?.toString();
    const selected = answerInput.selectedOptionIds?.[0];
    const isCorrect = Boolean(correctId && selected && correctId === String(selected));
    if (isCorrect) return { isCorrect: true, pointsEarned: points };
    return { isCorrect: false, pointsEarned: negative > 0 ? -Math.min(negative, points) : 0 };
  }

  if (question.type === 'multi_select') {
    if (!hasResponse) return { isCorrect: false, pointsEarned: 0 };
    const correctIds = new Set(
      (question.options || []).filter((o) => o.isCorrect).map((o) => o._id.toString())
    );
    const selectedIds = new Set((answerInput.selectedOptionIds || []).map(String));
    const isExact =
      correctIds.size === selectedIds.size && [...correctIds].every((id) => selectedIds.has(id));
    if (isExact) return { isCorrect: true, pointsEarned: points };

    if (allowPartial && selectedIds.size > 0) {
      const allPickedAreCorrect = [...selectedIds].every((id) => correctIds.has(id));
      if (allPickedAreCorrect && correctIds.size > 0) {
        const earned = (selectedIds.size / correctIds.size) * points;
        return { isCorrect: false, pointsEarned: Math.round(earned * 100) / 100 };
      }
    }

    return { isCorrect: false, pointsEarned: negative > 0 ? -Math.min(negative, points) : 0 };
  }

  if (question.type === 'short_answer') {
    if (!hasResponse) return { isCorrect: false, pointsEarned: 0 };
    const normalized = normalizeShortAnswer(answerInput.textAnswer, question.caseSensitive);
    const accepted = (question.acceptedAnswers || []).map((a) =>
      normalizeShortAnswer(a, question.caseSensitive)
    );
    const isCorrect = accepted.includes(normalized);
    if (isCorrect) return { isCorrect: true, pointsEarned: points };
    return { isCorrect: false, pointsEarned: negative > 0 ? -Math.min(negative, points) : 0 };
  }

  return { isCorrect: false, pointsEarned: 0 };
}

function mapQuestionInput(q, i, fallbackSection = 'Section A') {
  return {
    type: q.type,
    prompt: q.prompt,
    points: q.points ?? 1,
    order: q.order ?? i,
    section: (q.section || fallbackSection).trim() || fallbackSection,
    explanation: q.explanation || '',
    options: q.options || [],
    acceptedAnswers: q.acceptedAnswers || [],
    caseSensitive: q.caseSensitive ?? false,
  };
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
  const sections =
    Array.isArray(body.sections) && body.sections.length
      ? body.sections.map((s) => String(s).trim()).filter(Boolean)
      : ['Section A'];
  const fallbackSection = sections[0] || 'Section A';

  const kind = body.kind === 'assessment' ? 'assessment' : 'online_exam';
  assertKindPermission(actor, kind, 'create');
  await assertExamKindAllowed(orgId, kind);

  const doc = await Assessment.create({
    orgId: orgOid(orgId),
    kind,
    title: body.title,
    description: body.description || '',
    durationMinutes:
      body.durationMinutes === undefined || body.durationMinutes === null
        ? 60
        : Number(body.durationMinutes),
    startAt: body.startAt ? new Date(body.startAt) : null,
    endAt: body.endAt ? new Date(body.endAt) : null,
    negativeMarkPerWrong: Number(body.negativeMarkPerWrong) || 0,
    allowPartialCredit: body.allowPartialCredit !== false,
    showAnswersAfterSubmit: body.showAnswersAfterSubmit !== false,
    cameraMonitor: kind === 'online_exam' && body.cameraMonitor === true,
    sections,
    status: 'draft',
    createdBy: actor._id,
    questions: body.questions.map((q, i) => mapQuestionInput(q, i, fallbackSection)),
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

  const requestedKind = query.kind === 'assessment' ? 'assessment' : 'online_exam';
  assertKindPermission(actor, requestedKind, 'create');
  await assertExamKindAllowed(orgId, requestedKind);

  const filter = { orgId: oid, ...ACTIVE, ...kindMongoFilter(requestedKind) };
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

  const { AssessmentAssignment } = models;
  const ids = items.map((a) => a._id);
  const counts =
    ids.length === 0
      ? []
      : await AssessmentAssignment.aggregate([
          { $match: { orgId: oid, assessmentId: { $in: ids } } },
          {
            $group: {
              _id: '$assessmentId',
              assignmentCount: { $sum: 1 },
              submittedCount: {
                $sum: { $cond: [{ $eq: ['$status', 'submitted'] }, 1, 0] },
              },
            },
          },
        ]);
  const countMap = new Map(counts.map((c) => [String(c._id), c]));

  return {
    assessments: items.map((a) => {
      const stats = countMap.get(String(a._id));
      const base = serializeAssessment(a);
      const totalMarks = (a.questions || []).reduce((sum, q) => sum + (q.points ?? 1), 0);
      return {
        ...base,
        questionCount: (a.questions || []).length,
        totalMarks,
        assignmentCount: stats?.assignmentCount || 0,
        submittedCount: stats?.submittedCount || 0,
      };
    }),
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

  await assertExamKindAllowed(orgId, storedExamKind(doc));
  assertKindPermission(actor, storedExamKind(doc), 'create');

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
  assertKindPermission(actor, storedExamKind(doc), 'create');

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
  if (body.durationMinutes !== undefined) doc.durationMinutes = Number(body.durationMinutes);
  if (body.startAt !== undefined) doc.startAt = body.startAt ? new Date(body.startAt) : null;
  if (body.endAt !== undefined) doc.endAt = body.endAt ? new Date(body.endAt) : null;
  if (body.negativeMarkPerWrong !== undefined) {
    doc.negativeMarkPerWrong = Number(body.negativeMarkPerWrong) || 0;
  }
  if (body.allowPartialCredit !== undefined) doc.allowPartialCredit = !!body.allowPartialCredit;
  if (body.showAnswersAfterSubmit !== undefined) {
    doc.showAnswersAfterSubmit = !!body.showAnswersAfterSubmit;
  }
  if (body.cameraMonitor !== undefined) {
    doc.cameraMonitor = storedExamKind(doc) === 'online_exam' && !!body.cameraMonitor;
  }
  if (body.sections !== undefined) {
    doc.sections =
      Array.isArray(body.sections) && body.sections.length
        ? body.sections.map((s) => String(s).trim()).filter(Boolean)
        : ['Section A'];
  }
  if (body.questions !== undefined) {
    const fallback = (doc.sections && doc.sections[0]) || 'Section A';
    doc.questions = body.questions.map((q, i) => mapQuestionInput(q, i, fallback));
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

export async function unpublishAssessment(models, actor, orgId, assessmentId) {
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

  if (doc.status !== 'published') {
    const err = new Error('Only published assessments can be unpublished');
    err.status = 400;
    throw err;
  }

  doc.status = 'draft';
  doc.resultsReleased = false;
  doc.resultsReleasedAt = null;
  await doc.save();
  return serializeAssessment(doc.toObject());
}

export async function deleteAssessment(models, actor, orgId, assessmentId) {
  if (!canCreateAssessment(actor)) {
    const err = new Error('Missing permission: assessment_create');
    err.status = 403;
    throw err;
  }

  const { Assessment, AssessmentAssignment } = models;
  const oid = orgOid(orgId);
  const doc = await Assessment.findOne({ _id: assessmentId, orgId: oid, ...ACTIVE });
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

  doc.deletedAt = new Date();
  await doc.save();
  await AssessmentAssignment.deleteMany({ orgId: oid, assessmentId: doc._id });
  return { ok: true };
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

  if (assessment.status === 'closed') {
    const err = new Error('Closed assessments cannot be assigned');
    err.status = 400;
    throw err;
  }

  if (actor.hierarchyRole === 'subordinate' && assessment.createdBy?.toString() !== actor._id.toString()) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }

  const allowed = await allowedStudentIdSet(models, actor, orgId);

  const { studentIds: fromGroups, studentToGroupIds } = body.groupIds?.length
    ? await resolveGroupsForAssign(models, actor, orgId, body.groupIds)
    : { studentIds: [], studentToGroupIds: new Map() };
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

  const year = await resolveAcademicYear(models, orgId, body.academicYearId);
  if (!year) {
    const err = new Error('No academic year configured. Create one under Academic years first.');
    err.status = 400;
    throw err;
  }

  const maxScore = (assessment.questions || []).reduce((sum, q) => sum + (q.points ?? 1), 0);
  const created = [];
  const dueDateValue = body.dueDate || null;

  for (const studentId of studentIds) {
    const sourceGroupIds = (studentToGroupIds.get(String(studentId)) || []).map(
      (gid) => new mongoose.Types.ObjectId(gid)
    );
    const update = {
      // Due date always applies to every student in the selected groups.
      $set: {
        dueDate: dueDateValue,
      },
      $setOnInsert: {
        orgId: oid,
        assessmentId: assessment._id,
        studentId: new mongoose.Types.ObjectId(studentId),
        assignedBy: actor._id,
        academicYearId: year._id,
        status: 'pending',
        maxScore,
        score: 0,
        answers: [],
      },
    };
    if (sourceGroupIds.length) {
      update.$addToSet = { sourceGroupIds: { $each: sourceGroupIds } };
    }

    const assignment = await AssessmentAssignment.findOneAndUpdate(
      {
        orgId: oid,
        assessmentId: assessment._id,
        studentId,
        academicYearId: year._id,
      },
      update,
      { upsert: true, new: true }
    );
    created.push(
      serializeAssignment(assignment.toObject(), {
        academicYearLabel: year.label,
      })
    );
  }

  return { assignments: created, academicYear: { id: String(year._id), label: year.label } };
}

export async function listMyAssignments(models, actor, orgId, query = {}) {
  const { AssessmentAssignment, Assessment, User, AcademicYear } = models;
  const oid = orgOid(orgId);

  if (query.kind === 'assessment' || query.kind === 'online_exam') {
    assertKindPermission(actor, query.kind, 'view');
  } else if (
    !actor.permissions.includes(PERMISSION_KEYS.ASSESSMENT_VIEW) &&
    !actor.permissions.includes(PERMISSION_KEYS.ONLINE_EXAM_VIEW)
  ) {
    const err = new Error('Missing permission: assessment_view');
    err.status = 403;
    throw err;
  }

  const { filter: yearFilter, year } = await academicYearAssignmentFilter(
    models,
    orgId,
    query.academicYearId
  );

  const baseFilter =
    actor.hierarchyRole === 'user'
      ? { orgId: oid, studentId: actor._id }
      : canCreateAssessment(actor)
        ? { orgId: oid, assignedBy: actor._id }
        : { orgId: oid, studentId: actor._id };

  const features = await loadOrgFeatures(orgId);
  const requestedKind =
    query.kind === 'assessment' || query.kind === 'online_exam' ? query.kind : null;
  if (requestedKind) await assertExamKindAllowed(orgId, requestedKind);
  const allowedKinds = requestedKind
    ? [requestedKind]
    : [
        ...(features.assessments ? ['assessment'] : []),
        ...(features.onlineExams ? ['online_exam'] : []),
      ];

  const filter = { ...baseFilter, ...yearFilter };

  const assignments = await AssessmentAssignment.find(filter).sort({ createdAt: -1 }).lean();
  const assessmentIds = [...new Set(assignments.map((a) => String(a.assessmentId)))];
  const assessments = await Assessment.find({ _id: { $in: assessmentIds }, ...ACTIVE }).lean();
  const assessmentMap = new Map(assessments.map((a) => [String(a._id), a]));

  const studentIds = [...new Set(assignments.map((a) => String(a.studentId)))];
  const students = await User.find({ _id: { $in: studentIds } }).lean();
  const studentMap = new Map(students.map((s) => [String(s._id), s]));

  const yearIds = [...new Set(assignments.map((a) => (a.academicYearId ? String(a.academicYearId) : null)).filter(Boolean))];
  const years = yearIds.length
    ? await AcademicYear.find({ _id: { $in: yearIds } }).lean()
    : [];
  const yearMap = new Map(years.map((y) => [String(y._id), y]));

  return {
    academicYear: year ? { id: String(year._id), label: year.label, isCurrent: !!year.isCurrent } : null,
    assignments: assignments
      .map((a) => {
        const assessment = assessmentMap.get(String(a.assessmentId));
        const student = studentMap.get(String(a.studentId));
        const ay = a.academicYearId ? yearMap.get(String(a.academicYearId)) : null;
        return {
          assignment: a,
          assessment,
          student,
          ay,
        };
      })
      .filter(({ assessment }) => {
        if (!assessment) return false;
        if (!allowedKinds.includes(storedExamKind(assessment))) return false;
        // Students only see published assessments; teachers see all they assigned
        if (actor.hierarchyRole === 'user') return assessment.status === 'published';
        return true;
      })
      .map(({ assignment: a, assessment, student, ay }) => {
        const resultsVisible =
          actor.hierarchyRole !== 'user' || areAttemptResultsVisible(assessment, a);
        const questionCount = (assessment?.questions || []).length;
        const totalMarks = (assessment?.questions || []).reduce(
          (sum, q) => sum + (q.points ?? 1),
          0
        );
        const base = serializeAssignment(a, {
          assessmentTitle: assessment?.title || 'Unknown',
          assessmentDescription: assessment?.description || '',
          assessmentStatus: assessment?.status,
          durationMinutes: assessment?.durationMinutes ?? 60,
          startAt: assessment?.startAt || null,
          endAt: assessment?.endAt || null,
          questionCount,
          totalMarks,
          resultsReleased: Boolean(assessment?.resultsReleased),
          resultsVisible,
          studentLabel: student ? studentDisplayName(student) : 'Unknown',
          academicYearLabel: ay?.label || null,
        });
        if (actor.hierarchyRole === 'user' && a.status === 'submitted' && !resultsVisible) {
          return {
            ...base,
            score: null,
            maxScore: a.maxScore,
            answers: [],
          };
        }
        return base;
      }),
  };
}

export async function getAssignment(models, actor, orgId, assignmentId, options = {}) {
  const { AssessmentAssignment, Assessment } = models;
  const oid = orgOid(orgId);

  let assignment = await AssessmentAssignment.findOne({ _id: assignmentId, orgId: oid });
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

  await assertExamKindAllowed(orgId, storedExamKind(assessment));
  if (isStudentOwner) assertKindPermission(actor, storedExamKind(assessment), 'view');

  const durationMinutes = Number(assessment.durationMinutes ?? 60);
  const deferStart =
    Boolean(options.preview) && isStudentOwner && storedExamKind(assessment) === 'online_exam';

  // Enforce assessment window before starting.
  // Online exams stay unstarted while the student is on the camera and connection check.
  if (isStudentOwner && assignment.status === 'pending' && !assignment.startedAt) {
    const now = new Date();
    if (assessment.startAt && new Date(assessment.startAt).getTime() > now.getTime()) {
      const err = new Error('Assessment has not started yet');
      err.status = 400;
      throw err;
    }
    if (assessment.endAt && new Date(assessment.endAt).getTime() < now.getTime()) {
      const err = new Error('Assessment window has ended');
      err.status = 400;
      throw err;
    }
    if (!deferStart) {
      assignment.startedAt = now;
      if (durationMinutes > 0) {
        assignment.expiresAt = new Date(now.getTime() + durationMinutes * 60 * 1000);
      }
      await assignment.save();
    }
  }

  // Auto-submit if timer already expired
  if (
    isStudentOwner &&
    assignment.status === 'pending' &&
    assignment.expiresAt &&
    assignment.expiresAt.getTime() <= Date.now()
  ) {
    return submitAssignment(models, actor, orgId, assignmentId, {
      answers: [],
      submitReason: 'timer',
    });
  }

  const resultsVisible =
    isTeacher || areAttemptResultsVisible(assessment, assignment.toObject ? assignment.toObject() : assignment);
  const serializedAssessment = serializeAssessment(assessment, {
    includeAnswers: isTeacher || (assignment.status === 'submitted' && resultsVisible),
  });

  if (isStudentOwner && assignment.status === 'pending') {
    for (const q of serializedAssessment.questions) {
      delete q.acceptedAnswers;
      delete q.caseSensitive;
    }
  }

  // Students don't see answer key until results are announced
  if (isStudentOwner && assignment.status === 'submitted') {
    const showKey = resultsVisible && assessment.showAnswersAfterSubmit !== false;
    if (!showKey) {
      for (const q of serializedAssessment.questions) {
        delete q.acceptedAnswers;
        delete q.caseSensitive;
        if (q.options) {
          q.options = q.options.map(({ id, text }) => ({ id, text }));
        }
      }
    }
  }

  // Each student sees a different option order. Grading still uses option ids.
  if (isStudentOwner) {
    const studentKey = String(assignment.studentId);
    for (const q of serializedAssessment.questions) {
      if (Array.isArray(q.options) && q.options.length > 1) {
        q.options = shuffleWithSeed(q.options, `${studentKey}:${q.id}`);
      }
    }
  }

  let remainingSeconds = null;
  if (assignment.status === 'pending' && assignment.expiresAt) {
    remainingSeconds = Math.max(
      0,
      Math.floor((new Date(assignment.expiresAt).getTime() - Date.now()) / 1000)
    );
  } else if (assignment.status === 'pending' && durationMinutes <= 0) {
    remainingSeconds = null;
  }

  const assignmentPayload = serializeAssignment(
    assignment.toObject ? assignment.toObject() : assignment,
    {
      remainingSeconds,
      resultsVisible,
      resultsReleased: Boolean(assessment.resultsReleased),
    }
  );

  if (isStudentOwner && assignment.status === 'submitted' && !resultsVisible) {
    assignmentPayload.score = null;
    assignmentPayload.answers = [];
  }

  return {
    assignment: assignmentPayload,
    assessment: serializedAssessment,
  };
}

export async function recordFullscreenExit(models, actor, orgId, assignmentId) {
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
    const err = new Error('You have already submitted this exam');
    err.status = 409;
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
  if (storedExamKind(assessment) !== 'online_exam') {
    const err = new Error('Fullscreen lock applies to online exams only');
    err.status = 400;
    throw err;
  }
  await assertExamKindAllowed(orgId, 'online_exam');

  assignment.fullscreenExitCount = (assignment.fullscreenExitCount || 0) + 1;
  await assignment.save();

  const count = assignment.fullscreenExitCount;
  return {
    fullscreenExitCount: count,
    maxFullscreenExits: MAX_FULLSCREEN_EXITS,
    exitsRemaining: Math.max(0, MAX_FULLSCREEN_EXITS - count),
    forceSubmit: count >= MAX_FULLSCREEN_EXITS,
  };
}

const CAPTURE_COOLDOWN_MS = 12_000;
const CAPTURE_LIMIT = 30;

function decodeJpeg(image) {
  const raw = String(image || '').replace(/^data:image\/jpeg;base64,/, '');
  const buffer = Buffer.from(raw, 'base64');
  if (buffer.length < 32 || buffer.length > 120000) {
    const err = new Error('Image is empty or too large');
    err.status = 400;
    throw err;
  }
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    const err = new Error('Image must be a JPEG');
    err.status = 400;
    throw err;
  }
  return buffer;
}

export async function saveProctorCapture(models, actor, orgId, assignmentId, body) {
  if (!s3Configured()) {
    const err = new Error('Image storage is not configured');
    err.status = 503;
    throw err;
  }
  const { AssessmentAssignment, Assessment, ProctorCapture } = models;
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
  if (assignment.status !== 'pending') {
    const err = new Error('This exam is no longer in progress');
    err.status = 409;
    throw err;
  }

  const assessment = await Assessment.findOne({
    _id: assignment.assessmentId,
    orgId: oid,
    status: 'published',
    ...ACTIVE,
  }).lean();
  if (!assessment || storedExamKind(assessment) !== 'online_exam' || assessment.cameraMonitor !== true) {
    const err = new Error('Camera capture is not enabled for this exam');
    err.status = 400;
    throw err;
  }

  const latest = await ProctorCapture.findOne({ orgId: oid, assignmentId: assignment._id })
    .sort({ capturedAt: -1 })
    .select('capturedAt')
    .lean();
  if (latest && Date.now() - new Date(latest.capturedAt).getTime() < CAPTURE_COOLDOWN_MS) {
    return { saved: false, reason: 'cooldown' };
  }
  const count = await ProctorCapture.countDocuments({ orgId: oid, assignmentId: assignment._id });
  if (count >= CAPTURE_LIMIT) {
    return { saved: false, reason: 'limit' };
  }

  const buffer = decodeJpeg(body.image);
  const captureId = new mongoose.Types.ObjectId();
  const key = `proctor/${oid}/${assignment._id}/${captureId}.jpg`;
  const storagePath = await uploadBufferToS3(buffer, key, 'image/jpeg');
  await ProctorCapture.create({
    _id: captureId,
    orgId: oid,
    assignmentId: assignment._id,
    studentId: assignment.studentId,
    storagePath,
    capturedAt: new Date(),
  });
  return { saved: true, id: String(captureId) };
}

function assertCaptureReviewer(actor, assignment) {
  if (!canCreateAssessment(actor)) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
  if (actor.hierarchyRole !== 'admin' && assignment.assignedBy?.toString() !== actor._id.toString()) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
}

export async function listProctorCaptures(models, actor, orgId, assignmentId) {
  const { AssessmentAssignment, ProctorCapture } = models;
  const oid = orgOid(orgId);
  const assignment = await AssessmentAssignment.findOne({ _id: assignmentId, orgId: oid }).lean();
  if (!assignment) {
    const err = new Error('Assignment not found');
    err.status = 404;
    throw err;
  }
  assertCaptureReviewer(actor, assignment);
  const rows = await ProctorCapture.find({ orgId: oid, assignmentId: assignment._id })
    .sort({ capturedAt: 1 })
    .select('_id capturedAt')
    .lean();
  return {
    captures: rows.map((row) => ({
      id: String(row._id),
      capturedAt: row.capturedAt,
    })),
  };
}

export async function readProctorCapture(models, actor, orgId, assignmentId, captureId) {
  const { AssessmentAssignment, ProctorCapture } = models;
  const oid = orgOid(orgId);
  const assignment = await AssessmentAssignment.findOne({ _id: assignmentId, orgId: oid }).lean();
  if (!assignment) {
    const err = new Error('Assignment not found');
    err.status = 404;
    throw err;
  }
  assertCaptureReviewer(actor, assignment);
  const capture = await ProctorCapture.findOne({
    _id: captureId,
    orgId: oid,
    assignmentId: assignment._id,
  }).lean();
  if (!capture) {
    const err = new Error('Capture not found');
    err.status = 404;
    throw err;
  }
  const buffer = await downloadS3ToBuffer(capture.storagePath);
  return { buffer, capturedAt: capture.capturedAt };
}

export async function submitAssignment(models, actor, orgId, assignmentId, body) {
  if (
    !actor.permissions.includes(PERMISSION_KEYS.ASSESSMENT_SUBMIT) &&
    !actor.permissions.includes(PERMISSION_KEYS.ONLINE_EXAM_SUBMIT)
  ) {
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

  await assertExamKindAllowed(orgId, storedExamKind(assessment));
  assertKindPermission(actor, storedExamKind(assessment), 'submit');

  const questionMap = new Map((assessment.questions || []).map((q) => [q._id.toString(), q]));
  const inputByQuestion = new Map((body.answers || []).map((a) => [String(a.questionId), a]));

  const gradedAnswers = (assessment.questions || []).map((question) => {
    const input = inputByQuestion.get(question._id.toString()) || {
      questionId: String(question._id),
      selectedOptionIds: [],
      textAnswer: '',
    };

    if (question.type === 'short_answer') {
      const words = (input.textAnswer || '').trim().split(/\s+/).filter(Boolean);
      if (words.length > 2) {
        const err = new Error('Short answer must be 1–2 words');
        err.status = 400;
        throw err;
      }
    }

    const { isCorrect, pointsEarned } = gradeAnswer(question, input, assessment);

    return {
      questionId: question._id,
      selectedOptionIds: (input.selectedOptionIds || [])
        .filter(Boolean)
        .map((id) => new mongoose.Types.ObjectId(id)),
      textAnswer: input.textAnswer || '',
      isCorrect,
      pointsEarned,
    };
  });

  assignment.answers = gradedAnswers;
  assignment.score = Math.max(
    0,
    gradedAnswers.reduce((sum, a) => sum + (a.pointsEarned || 0), 0)
  );
  assignment.maxScore = (assessment.questions || []).reduce((sum, q) => sum + (q.points ?? 1), 0);
  assignment.status = 'submitted';
  assignment.submittedAt = new Date();
  const allowedReasons = ['manual', 'timer', 'fullscreen_exits'];
  let submitReason = allowedReasons.includes(body.submitReason) ? body.submitReason : 'manual';
  if (submitReason === 'fullscreen_exits' && storedExamKind(assessment) !== 'online_exam') {
    submitReason = 'manual';
  }
  assignment.submitReason = submitReason;
  if (!assignment.startedAt) assignment.startedAt = new Date();
  await assignment.save();

  return {
    assignment: serializeAssignment(assignment.toObject()),
    assessment: serializeAssessment(assessment, { includeAnswers: true }),
  };
}

export async function getAssessmentResults(models, actor, orgId, assessmentId, query = {}) {
  if (!canCreateAssessment(actor)) {
    const err = new Error('Missing permission: assessment_create');
    err.status = 403;
    throw err;
  }

  const { Assessment, AssessmentAssignment, User, AcademicYear } = models;
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

  const { filter: yearFilter, year } = await academicYearAssignmentFilter(
    models,
    orgId,
    query.academicYearId
  );

  const assignments = await AssessmentAssignment.find({
    orgId: oid,
    assessmentId,
    ...yearFilter,
  })
    .sort({ createdAt: -1 })
    .lean();
  const studentIds = assignments.map((a) => a.studentId);
  const students = await User.find({ _id: { $in: studentIds } }).lean();
  const studentMap = new Map(students.map((s) => [String(s._id), s]));

  const yearIds = [...new Set(assignments.map((a) => (a.academicYearId ? String(a.academicYearId) : null)).filter(Boolean))];
  const years = yearIds.length
    ? await AcademicYear.find({ _id: { $in: yearIds } }).lean()
    : [];
  const yearMap = new Map(years.map((y) => [String(y._id), y]));

  const questionCount = (assessment.questions || []).length;
  const totalMarks = (assessment.questions || []).reduce((sum, q) => sum + (q.points ?? 1), 0);

  const results = assignments.map((a) => {
    const student = studentMap.get(String(a.studentId));
    const ay = a.academicYearId ? yearMap.get(String(a.academicYearId)) : null;
    const answers = a.answers || [];

    let correctCount = 0;
    let partialCount = 0;
    let wrongCount = 0;
    let unansweredCount = 0;

    if (a.status === 'submitted') {
      for (const q of assessment.questions || []) {
        const ans = answers.find((x) => String(x.questionId) === String(q._id));
        const points = q.points ?? 1;
        const hasResponse =
          ans &&
          ((ans.selectedOptionIds || []).length > 0 || String(ans.textAnswer || '').trim().length > 0);
        if (!hasResponse) {
          unansweredCount += 1;
          continue;
        }
        const earned = Number(ans.pointsEarned) || 0;
        if (ans.isCorrect && earned >= points) correctCount += 1;
        else if (earned > 0 && earned < points) partialCount += 1;
        else if (ans.isCorrect) correctCount += 1;
        else wrongCount += 1;
      }
    } else {
      unansweredCount = questionCount;
    }

    const scoredMarks = a.status === 'submitted' ? Number(a.score) || 0 : 0;
    const maxScore = a.maxScore || totalMarks;
    const percentage = maxScore > 0 && a.status === 'submitted' ? (scoredMarks / maxScore) * 100 : 0;
    const timeTakenSeconds =
      a.startedAt && a.submittedAt
        ? Math.max(0, Math.floor((new Date(a.submittedAt) - new Date(a.startedAt)) / 1000))
        : null;

    return {
      ...serializeAssignment(a, {
        studentLabel: student ? studentDisplayName(student) : 'Unknown',
        studentEmail: student?.email || '',
        academicYearLabel: ay?.label || null,
      }),
      studentName: student ? studentDisplayName(student) : 'Unknown',
      scoredMarks,
      totalMarks: maxScore,
      percentage,
      correctCount: a.status === 'submitted' ? correctCount : 0,
      partialCount: a.status === 'submitted' ? partialCount : 0,
      wrongCount: a.status === 'submitted' ? wrongCount : 0,
      unansweredCount,
      timeTakenSeconds,
      autoSubmitted: a.submitReason === 'timer',
    };
  });

  const submitted = results.filter((r) => r.status === 'submitted');
  const percentages = submitted.map((r) => r.percentage);
  const averagePercentage =
    percentages.length > 0 ? percentages.reduce((s, p) => s + p, 0) / percentages.length : 0;
  const highestPercentage = percentages.length > 0 ? Math.max(...percentages) : 0;
  const pendingReleaseCount = countPendingReleaseAttempts(assessment, assignments);

  return {
    assessment: {
      ...serializeAssessment(assessment),
      questionCount,
      totalMarks,
    },
    academicYear: year ? { id: String(year._id), label: year.label, isCurrent: !!year.isCurrent } : null,
    summary: {
      assigned: results.length,
      submitted: submitted.length,
      pending: results.length - submitted.length,
      averagePercentage,
      highestPercentage,
      pendingReleaseCount,
    },
    results,
  };
}

export async function releaseAssessmentResults(models, actor, orgId, assessmentId, appUrl) {
  if (!canCreateAssessment(actor)) {
    const err = new Error('Missing permission: assessment_create');
    err.status = 403;
    throw err;
  }

  const { Assessment, AssessmentAssignment, User } = models;
  const oid = orgOid(orgId);

  const assessment = await Assessment.findOne({ _id: assessmentId, orgId: oid, ...ACTIVE });
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

  const assignments = await AssessmentAssignment.find({
    orgId: oid,
    assessmentId: assessment._id,
    status: 'submitted',
  }).lean();

  const toNotify = pendingReleaseAttempts(assessment.toObject(), assignments);
  if (toNotify.length === 0) {
    const err = new Error(
      assignments.length === 0
        ? 'No submitted attempts to announce yet.'
        : 'All submitted results are already announced. The button unlocks when a new attempt is submitted.'
    );
    err.status = 400;
    throw err;
  }

  const wasReleased = Boolean(assessment.resultsReleased);
  assessment.resultsReleased = true;
  assessment.resultsReleasedAt = new Date();
  await assessment.save();

  const studentIds = toNotify.map((a) => a.studentId);
  const students = await User.find({ _id: { $in: studentIds } }).lean();
  const studentMap = new Map(students.map((s) => [String(s._id), s]));

  const base = (appUrl || process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'http://localhost:5174')
    .split(',')[0]
    .trim()
    .replace(/\/$/, '');

  let emailed = 0;
  let skipped = 0;
  let failed = 0;

  for (const attempt of toNotify) {
    const student = studentMap.get(String(attempt.studentId));
    if (!student?.email || student.isActive === false) {
      skipped += 1;
      continue;
    }

    try {
      const outcome = await sendAssessmentResultsReleasedEmail({
        to: student.email,
        studentName: studentDisplayName(student),
        assessmentTitle: assessment.title,
        resultUrl: `${base}/my-assessments/${attempt._id}`,
      });
      if (outcome.sent) emailed += 1;
      else skipped += 1;
    } catch (err) {
      failed += 1;
      console.error(`[mailer] Failed to email ${student.email}:`, err?.message || err);
    }
  }

  return {
    message: wasReleased
      ? 'New results announced for late submissions. Students can now view those scores.'
      : 'Results released. Students can now view scores on the site.',
    assessment: serializeAssessment(assessment.toObject()),
    notify: {
      recipients: toNotify.length,
      emailed,
      skipped,
      failed,
    },
    summary: {
      pendingReleaseCount: 0,
    },
  };
}

export async function reattemptAssignment(models, actor, orgId, assessmentId, assignmentId) {
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

  if (actor.hierarchyRole === 'subordinate' && assessment.createdBy?.toString() !== actor._id.toString()) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }

  const assignment = await AssessmentAssignment.findOne({
    _id: assignmentId,
    orgId: oid,
    assessmentId,
  });
  if (!assignment) {
    const err = new Error('Assignment not found');
    err.status = 404;
    throw err;
  }

  assignment.status = 'pending';
  assignment.answers = [];
  assignment.score = 0;
  assignment.maxScore = (assessment.questions || []).reduce((sum, q) => sum + (q.points ?? 1), 0);
  assignment.startedAt = null;
  assignment.expiresAt = null;
  assignment.submittedAt = null;
  assignment.submitReason = undefined;
  assignment.fullscreenExitCount = 0;
  assignment.resultsHidden = false;
  await assignment.save();

  return { ok: true, assignment: serializeAssignment(assignment.toObject()) };
}

export async function setAssignmentResultsHidden(
  models,
  actor,
  orgId,
  assessmentId,
  assignmentId,
  hidden
) {
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

  if (actor.hierarchyRole === 'subordinate' && assessment.createdBy?.toString() !== actor._id.toString()) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }

  const assignment = await AssessmentAssignment.findOne({
    _id: assignmentId,
    orgId: oid,
    assessmentId,
  });
  if (!assignment) {
    const err = new Error('Assignment not found');
    err.status = 404;
    throw err;
  }
  if (assignment.status !== 'submitted') {
    const err = new Error('Only a submitted attempt can be hidden');
    err.status = 400;
    throw err;
  }

  assignment.resultsHidden = Boolean(hidden);
  await assignment.save();

  return {
    ok: true,
    resultsHidden: assignment.resultsHidden,
    assignment: serializeAssignment(assignment.toObject()),
  };
}

export async function deleteAssignmentResult(models, actor, orgId, assessmentId, assignmentId) {
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

  if (actor.hierarchyRole === 'subordinate' && assessment.createdBy?.toString() !== actor._id.toString()) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }

  const result = await AssessmentAssignment.deleteOne({
    _id: assignmentId,
    orgId: oid,
    assessmentId,
  });
  if (!result.deletedCount) {
    const err = new Error('Assignment not found');
    err.status = 404;
    throw err;
  }

  if (models.ProctorCapture) {
    const shots = await models.ProctorCapture.find({ orgId: oid, assignmentId }).select('storagePath').lean();
    await models.ProctorCapture.deleteMany({ orgId: oid, assignmentId });
    await Promise.all(shots.map((shot) => deleteS3Object(shot.storagePath).catch(() => {})));
  }

  return { ok: true };
}

/** Summary of who an assessment is already assigned to (for Assign modal reopen). */
export async function getAssessmentAssignmentSummary(models, actor, orgId, assessmentId, query = {}) {
  if (!canCreateAssessment(actor)) {
    const err = new Error('Missing permission: assessment_create');
    err.status = 403;
    throw err;
  }

  const { Assessment, AssessmentAssignment } = models;
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

  const { filter: yearFilter, year } = await academicYearAssignmentFilter(
    models,
    orgId,
    query.academicYearId
  );

  const assignments = await AssessmentAssignment.find({
    orgId: oid,
    assessmentId,
    ...yearFilter,
  }).lean();

  const assignedStudentIds = [...new Set(assignments.map((a) => String(a.studentId)))];
  const assignedSet = new Set(assignedStudentIds);

  const persistedGroupIds = new Set();
  for (const a of assignments) {
    for (const gid of a.sourceGroupIds || []) {
      persistedGroupIds.add(String(gid));
    }
  }

  let groups = [];
  try {
    const listed = await listStudentGroups(models, actor, orgId);
    groups = listed.groups || [];
  } catch {
    groups = [];
  }

  // Prefer stored source groups when present; otherwise infer fully-covered groups (legacy assigns).
  let assignedGroupIds;
  if (persistedGroupIds.size > 0) {
    assignedGroupIds = [...persistedGroupIds];
  } else {
    assignedGroupIds = groups
      .filter((g) => {
        const members = g.studentIds || [];
        return members.length > 0 && members.every((sid) => assignedSet.has(String(sid)));
      })
      .map((g) => g.id);
  }
  const withDue = assignments.filter((a) => a.dueDate);
  const dueDate = withDue.length
    ? withDue.sort((a, b) => new Date(b.dueDate) - new Date(a.dueDate))[0].dueDate
    : null;

  const groupNameById = new Map(groups.map((g) => [g.id, g.name]));
  const assignedGroups = assignedGroupIds.map((id) => ({
    id,
    name: groupNameById.get(id) || 'Group',
  }));

  return {
    academicYear: year ? { id: String(year._id), label: year.label, isCurrent: !!year.isCurrent } : null,
    assignedStudentIds,
    assignedGroupIds,
    assignedGroups,
    totalAssigned: assignedStudentIds.length,
    dueDate,
  };
}
