import mongoose from 'mongoose';
import { PERMISSION_KEYS } from '../../constants/permissions.js';
import { logActivity } from '../../utils/activity.js';

const ACTIVE = { deletedAt: null };

function orgOid(orgId) {
  return new mongoose.Types.ObjectId(String(orgId));
}

function canManage(actor) {
  return (
    actor.hierarchyRole === 'admin' &&
    (actor.permissions.includes(PERMISSION_KEYS.CLASS_MANAGE) ||
      actor.permissions.includes(PERMISSION_KEYS.SETTINGS_MANAGE))
  );
}

function serialize(doc) {
  return {
    id: String(doc._id),
    label: doc.label,
    startDate: doc.startDate || null,
    endDate: doc.endDate || null,
    isCurrent: !!doc.isCurrent,
    isActive: doc.isActive !== false,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export async function listAcademicYears(models, _actor, orgId) {
  // Any authenticated tenant user may list years (students filter My assessments by year).
  const { AcademicYear } = models;
  const years = await AcademicYear.find({ orgId: orgOid(orgId), ...ACTIVE })
    .sort({ label: -1 })
    .lean();
  return { academicYears: years.map(serialize) };
}

export async function getAcademicYear(models, _actor, orgId, id) {
  const { AcademicYear } = models;
  const doc = await AcademicYear.findOne({ _id: id, orgId: orgOid(orgId), ...ACTIVE }).lean();
  if (!doc) {
    const err = new Error('Academic year not found');
    err.status = 404;
    throw err;
  }
  return serialize(doc);
}

export async function createAcademicYear(models, actor, orgId, body, ip) {
  if (!canManage(actor)) {
    const err = new Error('Only administrators may manage academic years');
    err.status = 403;
    throw err;
  }

  const { AcademicYear } = models;
  const oid = orgOid(orgId);

  const existing = await AcademicYear.findOne({
    orgId: oid,
    label: body.label,
    ...ACTIVE,
  }).lean();
  if (existing) {
    const err = new Error(`Academic year "${body.label}" already exists`);
    err.status = 409;
    throw err;
  }

  if (body.isCurrent) {
    await AcademicYear.updateMany({ orgId: oid, isCurrent: true }, { $set: { isCurrent: false } });
  }

  const doc = await AcademicYear.create({
    orgId: oid,
    label: body.label,
    startDate: body.startDate || null,
    endDate: body.endDate || null,
    isCurrent: !!body.isCurrent,
    isActive: true,
  });

  await logActivity({
    models,
    orgId: oid,
    actorId: actor._id,
    action: 'academic_year.created',
    resourceType: 'AcademicYear',
    resourceId: doc._id,
    metadata: { label: doc.label },
    ip,
  });

  return serialize(doc);
}

export async function updateAcademicYear(models, actor, orgId, id, body, ip) {
  if (!canManage(actor)) {
    const err = new Error('Only administrators may manage academic years');
    err.status = 403;
    throw err;
  }

  const { AcademicYear } = models;
  const oid = orgOid(orgId);
  const doc = await AcademicYear.findOne({ _id: id, orgId: oid, ...ACTIVE });
  if (!doc) {
    const err = new Error('Academic year not found');
    err.status = 404;
    throw err;
  }

  if (body.label !== undefined && body.label !== doc.label) {
    const clash = await AcademicYear.findOne({
      orgId: oid,
      label: body.label,
      _id: { $ne: doc._id },
      ...ACTIVE,
    }).lean();
    if (clash) {
      const err = new Error(`Academic year "${body.label}" already exists`);
      err.status = 409;
      throw err;
    }
    doc.label = body.label;
  }

  if (body.startDate !== undefined) doc.startDate = body.startDate || null;
  if (body.endDate !== undefined) doc.endDate = body.endDate || null;
  if (body.isActive !== undefined) doc.isActive = body.isActive;

  if (body.isCurrent === true) {
    await AcademicYear.updateMany(
      { orgId: oid, isCurrent: true, _id: { $ne: doc._id } },
      { $set: { isCurrent: false } }
    );
    doc.isCurrent = true;
  } else if (body.isCurrent === false) {
    doc.isCurrent = false;
  }

  await doc.save();

  // Keep denormalized label on academic classes in sync
  if (body.label !== undefined) {
    const { Class } = models;
    await Class.updateMany(
      { orgId: oid, academicYearId: doc._id, ...ACTIVE },
      { $set: { academicYear: doc.label } }
    );
  }

  await logActivity({
    models,
    orgId: oid,
    actorId: actor._id,
    action: 'academic_year.updated',
    resourceType: 'AcademicYear',
    resourceId: doc._id,
    metadata: { label: doc.label, changes: Object.keys(body) },
    ip,
  });

  return serialize(doc);
}

export async function deleteAcademicYear(models, actor, orgId, id, ip) {
  if (!canManage(actor)) {
    const err = new Error('Only administrators may manage academic years');
    err.status = 403;
    throw err;
  }

  const { AcademicYear, Class } = models;
  const oid = orgOid(orgId);
  const doc = await AcademicYear.findOne({ _id: id, orgId: oid, ...ACTIVE });
  if (!doc) {
    const err = new Error('Academic year not found');
    err.status = 404;
    throw err;
  }

  const classCount = await Class.countDocuments({
    orgId: oid,
    academicYearId: doc._id,
    ...ACTIVE,
  });
  if (classCount > 0) {
    const err = new Error(
      `Cannot archive academic year with ${classCount} active class${classCount === 1 ? '' : 'es'}`
    );
    err.status = 400;
    throw err;
  }

  doc.deletedAt = new Date();
  doc.isActive = false;
  doc.isCurrent = false;
  await doc.save();

  await logActivity({
    models,
    orgId: oid,
    actorId: actor._id,
    action: 'academic_year.archived',
    resourceType: 'AcademicYear',
    resourceId: doc._id,
    metadata: { label: doc.label },
    ip,
  });

  return { ok: true };
}
