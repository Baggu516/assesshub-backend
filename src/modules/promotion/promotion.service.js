import mongoose from 'mongoose';
import { PERMISSION_KEYS } from '../../constants/permissions.js';
import { logActivity } from '../../utils/activity.js';

const ACTIVE = { deletedAt: null };

function orgOid(orgId) {
  return new mongoose.Types.ObjectId(String(orgId));
}

function displayName(u) {
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return name || u.email;
}

function canManage(actor) {
  return (
    actor.hierarchyRole === 'admin' &&
    (actor.permissions.includes(PERMISSION_KEYS.CLASS_MANAGE) ||
      actor.permissions.includes(PERMISSION_KEYS.SETTINGS_MANAGE))
  );
}

function buildClassName(masterName, section) {
  const s = (section || '').trim();
  return s ? `${masterName} ${s}` : masterName;
}

/**
 * Preview who would be promoted from fromYear → toYear.
 * Suggests next ClassMaster via ClassMaster.nextClassMasterId (or same if retain).
 */
export async function previewPromotion(models, actor, orgId, { fromAcademicYearId, toAcademicYearId }) {
  if (!canManage(actor)) {
    const err = new Error('Only administrators may run promotions');
    err.status = 403;
    throw err;
  }

  const { AcademicYear, Class, ClassMaster, Enrollment, User } = models;
  const oid = orgOid(orgId);

  const [fromYear, toYear] = await Promise.all([
    AcademicYear.findOne({ _id: fromAcademicYearId, orgId: oid, ...ACTIVE }).lean(),
    AcademicYear.findOne({ _id: toAcademicYearId, orgId: oid, ...ACTIVE }).lean(),
  ]);

  if (!fromYear || !toYear) {
    const err = new Error('Academic year not found');
    err.status = 404;
    throw err;
  }
  if (String(fromYear._id) === String(toYear._id)) {
    const err = new Error('Source and target academic years must differ');
    err.status = 400;
    throw err;
  }

  const fromClasses = await Class.find({
    orgId: oid,
    academicYearId: fromYear._id,
    ...ACTIVE,
  }).lean();
  const toClasses = await Class.find({
    orgId: oid,
    academicYearId: toYear._id,
    ...ACTIVE,
  }).lean();

  const masters = await ClassMaster.find({ orgId: oid, ...ACTIVE }).lean();
  const masterMap = new Map(masters.map((m) => [String(m._id), m]));

  const enrollments = await Enrollment.find({
    orgId: oid,
    academicYearId: fromYear._id,
    isActive: true,
  }).lean();

  const studentIds = [...new Set(enrollments.map((e) => String(e.studentId)))];
  const users = studentIds.length
    ? await User.find({ _id: { $in: studentIds }, isActive: { $ne: false } }).lean()
    : [];
  const userMap = new Map(users.map((u) => [String(u._id), u]));

  const alreadyInTarget = await Enrollment.find({
    orgId: oid,
    academicYearId: toYear._id,
    studentId: { $in: studentIds },
    isActive: true,
  }).lean();
  const alreadySet = new Set(alreadyInTarget.map((e) => String(e.studentId)));

  const toClassIndex = new Map();
  for (const c of toClasses) {
    const key = `${String(c.classMasterId)}|${(c.section || '').trim()}`;
    toClassIndex.set(key, c);
  }

  const fromClassMap = new Map(fromClasses.map((c) => [String(c._id), c]));

  const students = [];
  for (const e of enrollments) {
    const sid = String(e.studentId);
    const u = userMap.get(sid);
    if (!u) continue;

    const fromClass = fromClassMap.get(String(e.academicClassId));
    const fromMaster = fromClass?.classMasterId
      ? masterMap.get(String(fromClass.classMasterId))
      : null;
    const suggestedMasterId = fromMaster?.nextClassMasterId
      ? String(fromMaster.nextClassMasterId)
      : fromMaster
        ? String(fromMaster._id)
        : null;
    const suggestedSection = fromClass?.section || '';
    const suggestedMaster = suggestedMasterId ? masterMap.get(suggestedMasterId) : null;

    const targetKey = suggestedMasterId
      ? `${suggestedMasterId}|${suggestedSection.trim()}`
      : null;
    const existingTargetClass = targetKey ? toClassIndex.get(targetKey) : null;

    students.push({
      studentId: sid,
      studentLabel: displayName(u),
      email: u.email,
      enrollmentId: String(e._id),
      fromClassId: fromClass ? String(fromClass._id) : null,
      fromClassName: fromClass?.name || '',
      fromClassMasterId: fromMaster ? String(fromMaster._id) : null,
      fromSection: fromClass?.section || '',
      suggestedAction: fromMaster?.nextClassMasterId ? 'promote' : 'retain',
      suggestedClassMasterId: suggestedMasterId,
      suggestedClassMasterName: suggestedMaster?.name || null,
      suggestedSection,
      suggestedTargetClassId: existingTargetClass ? String(existingTargetClass._id) : null,
      alreadyEnrolledInTarget: alreadySet.has(sid),
    });
  }

  return {
    fromYear: { id: String(fromYear._id), label: fromYear.label },
    toYear: { id: String(toYear._id), label: toYear.label },
    targetClasses: toClasses.map((c) => ({
      id: String(c._id),
      name: c.name,
      classMasterId: c.classMasterId ? String(c.classMasterId) : null,
      section: c.section || '',
    })),
    classMasters: masters.map((m) => ({
      id: String(m._id),
      name: m.name,
      nextClassMasterId: m.nextClassMasterId ? String(m.nextClassMasterId) : null,
    })),
    students,
  };
}

/**
 * Execute promotions. Never overwrites old enrollments — ends them and creates new ones.
 *
 * body.promotions: [{
 *   studentId,
 *   enrollmentId,
 *   action: 'promote' | 'retain' | 'skip',
 *   targetClassId?: string,          // existing academic class in toYear
 *   classMasterId?: string,          // create/find academic class
 *   section?: string,
 *   createClassIfMissing?: boolean,
 * }]
 */
export async function executePromotion(
  models,
  actor,
  orgId,
  { fromAcademicYearId, toAcademicYearId, promotions },
  ip
) {
  if (!canManage(actor)) {
    const err = new Error('Only administrators may run promotions');
    err.status = 403;
    throw err;
  }

  const { AcademicYear, Class, ClassMaster, Enrollment } = models;
  const oid = orgOid(orgId);

  const [fromYear, toYear] = await Promise.all([
    AcademicYear.findOne({ _id: fromAcademicYearId, orgId: oid, ...ACTIVE }).lean(),
    AcademicYear.findOne({ _id: toAcademicYearId, orgId: oid, ...ACTIVE }).lean(),
  ]);

  if (!fromYear || !toYear) {
    const err = new Error('Academic year not found');
    err.status = 404;
    throw err;
  }
  if (String(fromYear._id) === String(toYear._id)) {
    const err = new Error('Source and target academic years must differ');
    err.status = 400;
    throw err;
  }

  const results = { promoted: 0, retained: 0, skipped: 0, errors: [] };

  async function findOrCreateTargetClass(classMasterId, section) {
    const sec = (section || '').trim();
    let target = await Class.findOne({
      orgId: oid,
      academicYearId: toYear._id,
      classMasterId,
      section: sec,
      ...ACTIVE,
    });
    if (target) return target;

    const master = await ClassMaster.findOne({
      _id: classMasterId,
      orgId: oid,
      ...ACTIVE,
    }).lean();
    if (!master) {
      const err = new Error('Class master not found');
      err.status = 400;
      throw err;
    }

    target = await Class.create({
      orgId: oid,
      name: buildClassName(master.name, sec),
      description: '',
      academicYear: toYear.label,
      academicYearId: toYear._id,
      classMasterId: master._id,
      section: sec,
      createdBy: actor._id,
      isActive: true,
    });
    return target;
  }

  for (const row of promotions || []) {
    try {
      if (row.action === 'skip') {
        results.skipped += 1;
        continue;
      }

      const enrollment = await Enrollment.findOne({
        _id: row.enrollmentId,
        orgId: oid,
        studentId: row.studentId,
        academicYearId: fromYear._id,
        isActive: true,
      });
      if (!enrollment) {
        results.errors.push({ studentId: row.studentId, error: 'Active enrollment not found' });
        continue;
      }

      const existingTarget = await Enrollment.findOne({
        orgId: oid,
        academicYearId: toYear._id,
        studentId: row.studentId,
        isActive: true,
      }).lean();
      if (existingTarget) {
        results.errors.push({
          studentId: row.studentId,
          error: 'Student already enrolled in target year',
        });
        results.skipped += 1;
        continue;
      }

      let targetClass = null;
      if (row.targetClassId) {
        targetClass = await Class.findOne({
          _id: row.targetClassId,
          orgId: oid,
          academicYearId: toYear._id,
          ...ACTIVE,
        });
        if (!targetClass) {
          results.errors.push({ studentId: row.studentId, error: 'Target class not found' });
          continue;
        }
      } else if (row.classMasterId) {
        targetClass = await findOrCreateTargetClass(row.classMasterId, row.section || '');
      } else {
        results.errors.push({
          studentId: row.studentId,
          error: 'targetClassId or classMasterId required',
        });
        continue;
      }

      const endStatus = row.action === 'retain' ? 'retained' : 'promoted';
      enrollment.isActive = false;
      enrollment.status = endStatus;
      enrollment.endedAt = new Date();
      await enrollment.save();

      await Enrollment.create({
        orgId: oid,
        studentId: enrollment.studentId,
        academicClassId: targetClass._id,
        academicYearId: toYear._id,
        status: 'active',
        isActive: true,
        enrolledAt: new Date(),
        endedAt: null,
        previousEnrollmentId: enrollment._id,
      });

      if (row.action === 'retain') results.retained += 1;
      else results.promoted += 1;
    } catch (e) {
      results.errors.push({ studentId: row.studentId, error: e.message || 'Failed' });
    }
  }

  await logActivity({
    models,
    orgId: oid,
    actorId: actor._id,
    action: 'promotion.executed',
    resourceType: 'Promotion',
    resourceId: toYear._id,
    metadata: {
      fromYear: fromYear.label,
      toYear: toYear.label,
      promoted: results.promoted,
      retained: results.retained,
      skipped: results.skipped,
      errorCount: results.errors.length,
    },
    ip,
  });

  return {
    fromYear: { id: String(fromYear._id), label: fromYear.label },
    toYear: { id: String(toYear._id), label: toYear.label },
    ...results,
  };
}
