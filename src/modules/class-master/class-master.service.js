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
    name: doc.name,
    description: doc.description || '',
    nextClassMasterId: doc.nextClassMasterId ? String(doc.nextClassMasterId) : null,
    sortOrder: doc.sortOrder ?? 0,
    isActive: doc.isActive !== false,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export async function listClassMasters(models, actor, orgId) {
  if (!canManage(actor) && actor.hierarchyRole !== 'subordinate') {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }

  const { ClassMaster } = models;
  const rows = await ClassMaster.find({ orgId: orgOid(orgId), ...ACTIVE })
    .sort({ sortOrder: 1, name: 1 })
    .lean();
  return { classMasters: rows.map(serialize) };
}

export async function createClassMaster(models, actor, orgId, body, ip) {
  if (!canManage(actor)) {
    const err = new Error('Only administrators may manage class masters');
    err.status = 403;
    throw err;
  }

  const { ClassMaster } = models;
  const oid = orgOid(orgId);

  const existing = await ClassMaster.findOne({ orgId: oid, name: body.name, ...ACTIVE }).lean();
  if (existing) {
    const err = new Error(`Class master "${body.name}" already exists`);
    err.status = 409;
    throw err;
  }

  if (body.nextClassMasterId) {
    const next = await ClassMaster.findOne({
      _id: body.nextClassMasterId,
      orgId: oid,
      ...ACTIVE,
    }).lean();
    if (!next) {
      const err = new Error('Next class master not found');
      err.status = 400;
      throw err;
    }
  }

  const doc = await ClassMaster.create({
    orgId: oid,
    name: body.name,
    description: body.description || '',
    nextClassMasterId: body.nextClassMasterId || null,
    sortOrder: body.sortOrder ?? 0,
    isActive: true,
  });

  await logActivity({
    models,
    orgId: oid,
    actorId: actor._id,
    action: 'class_master.created',
    resourceType: 'ClassMaster',
    resourceId: doc._id,
    metadata: { name: doc.name },
    ip,
  });

  return serialize(doc);
}

export async function updateClassMaster(models, actor, orgId, id, body, ip) {
  if (!canManage(actor)) {
    const err = new Error('Only administrators may manage class masters');
    err.status = 403;
    throw err;
  }

  const { ClassMaster } = models;
  const oid = orgOid(orgId);
  const doc = await ClassMaster.findOne({ _id: id, orgId: oid, ...ACTIVE });
  if (!doc) {
    const err = new Error('Class master not found');
    err.status = 404;
    throw err;
  }

  if (body.name !== undefined && body.name !== doc.name) {
    const clash = await ClassMaster.findOne({
      orgId: oid,
      name: body.name,
      _id: { $ne: doc._id },
      ...ACTIVE,
    }).lean();
    if (clash) {
      const err = new Error(`Class master "${body.name}" already exists`);
      err.status = 409;
      throw err;
    }
    doc.name = body.name;
  }

  if (body.description !== undefined) doc.description = body.description;
  if (body.sortOrder !== undefined) doc.sortOrder = body.sortOrder;
  if (body.isActive !== undefined) doc.isActive = body.isActive;

  if (body.nextClassMasterId !== undefined) {
    if (body.nextClassMasterId) {
      if (String(body.nextClassMasterId) === String(doc._id)) {
        const err = new Error('A class master cannot promote into itself');
        err.status = 400;
        throw err;
      }
      const next = await ClassMaster.findOne({
        _id: body.nextClassMasterId,
        orgId: oid,
        ...ACTIVE,
      }).lean();
      if (!next) {
        const err = new Error('Next class master not found');
        err.status = 400;
        throw err;
      }
      doc.nextClassMasterId = body.nextClassMasterId;
    } else {
      doc.nextClassMasterId = null;
    }
  }

  await doc.save();

  // Refresh denormalized academic class names when master name changes
  if (body.name !== undefined) {
    const { Class } = models;
    const classes = await Class.find({
      orgId: oid,
      classMasterId: doc._id,
      ...ACTIVE,
    });
    for (const c of classes) {
      const section = (c.section || '').trim();
      c.name = section ? `${doc.name} ${section}` : doc.name;
      await c.save();
    }
  }

  await logActivity({
    models,
    orgId: oid,
    actorId: actor._id,
    action: 'class_master.updated',
    resourceType: 'ClassMaster',
    resourceId: doc._id,
    metadata: { name: doc.name, changes: Object.keys(body) },
    ip,
  });

  return serialize(doc);
}

export async function deleteClassMaster(models, actor, orgId, id, ip) {
  if (!canManage(actor)) {
    const err = new Error('Only administrators may manage class masters');
    err.status = 403;
    throw err;
  }

  const { ClassMaster, Class } = models;
  const oid = orgOid(orgId);
  const doc = await ClassMaster.findOne({ _id: id, orgId: oid, ...ACTIVE });
  if (!doc) {
    const err = new Error('Class master not found');
    err.status = 404;
    throw err;
  }

  const classCount = await Class.countDocuments({
    orgId: oid,
    classMasterId: doc._id,
    ...ACTIVE,
  });
  if (classCount > 0) {
    const err = new Error(
      `Cannot archive class master with ${classCount} active academic class${classCount === 1 ? '' : 'es'}`
    );
    err.status = 400;
    throw err;
  }

  doc.deletedAt = new Date();
  doc.isActive = false;
  await doc.save();

  await ClassMaster.updateMany(
    { orgId: oid, nextClassMasterId: doc._id },
    { $set: { nextClassMasterId: null } }
  );

  await logActivity({
    models,
    orgId: oid,
    actorId: actor._id,
    action: 'class_master.archived',
    resourceType: 'ClassMaster',
    resourceId: doc._id,
    metadata: { name: doc.name },
    ip,
  });

  return { ok: true };
}
