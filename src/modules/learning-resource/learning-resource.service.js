import mongoose from 'mongoose';
import { PERMISSION_KEYS } from '../../constants/permissions.js';
import { Organization } from '../../models/Organization.js';
import { normalizeOrgFeatures } from '../../middleware/plan.middleware.js';
import { deleteS3Object, readStorageBytes, uploadBufferToS3 } from '../../utils/s3.js';

const ACTIVE = { deletedAt: null };

function orgOid(orgId) {
  return new mongoose.Types.ObjectId(String(orgId));
}

function canManage(actor) {
  return (
    actor.permissions?.includes(PERMISSION_KEYS.ASSESSMENT_CREATE) ||
    actor.permissions?.includes(PERMISSION_KEYS.SETTINGS_MANAGE) ||
    actor.permissions?.includes(PERMISSION_KEYS.CLASS_MANAGE)
  );
}

function isStudent(actor) {
  return actor.hierarchyRole === 'user';
}

export function windowState(doc, now = new Date()) {
  const start = doc.startAt ? new Date(doc.startAt) : null;
  const end = doc.endAt ? new Date(doc.endAt) : null;
  return {
    isNotYetOpen: Boolean(start && start.getTime() > now.getTime()),
    isClosed: Boolean(end && end.getTime() < now.getTime()),
  };
}

function serialize(doc, classNameById = new Map()) {
  const window = windowState(doc);
  return {
    id: String(doc._id),
    kind: doc.kind,
    title: doc.title,
    description: doc.description || '',
    classIds: (doc.classIds || []).map(String),
    classNames: (doc.classIds || [])
      .map((id) => classNameById.get(String(id)))
      .filter(Boolean),
    fileName: doc.fileName || '',
    fileMimeType: doc.fileMimeType || '',
    fileSize: doc.fileSize || 0,
    hasFile: Boolean(doc.fileStoragePath),
    startAt: doc.startAt || null,
    endAt: doc.endAt || null,
    dueAt: doc.dueAt || null,
    isPublished: doc.isPublished !== false,
    isNotYetOpen: window.isNotYetOpen,
    isClosed: window.isClosed,
    createdBy: doc.createdBy ? String(doc.createdBy) : null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function assertKindEnabled(orgId, kind) {
  const org = await Organization.findById(orgId).select('features plan subdomain').lean();
  const features = normalizeOrgFeatures(org);
  if (kind !== 'worksheet' || !features.worksheets) {
    const err = new Error('Worksheets are not included in this organization plan.');
    err.status = 403;
    throw err;
  }
}

function parseKind(value) {
  if (value === 'worksheet') return value;
  const err = new Error('Only worksheets are supported');
  err.status = 400;
  throw err;
}

function parseDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    const err = new Error('Invalid date');
    err.status = 400;
    throw err;
  }
  return d;
}

function parseClassIds(value) {
  let raw = value;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      raw = JSON.parse(trimmed);
    } catch {
      raw = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(String).filter(Boolean))].map((id) => new mongoose.Types.ObjectId(id));
}

function parsePublished(value) {
  if (value === undefined || value === null || value === '') return true;
  return value === true || value === 'true' || value === '1';
}

async function classNameMap(models, orgId, ids) {
  if (!ids.length) return new Map();
  const { Class } = models;
  const rows = await Class.find({ _id: { $in: ids }, orgId: orgOid(orgId) })
    .select('name')
    .lean();
  return new Map(rows.map((c) => [String(c._id), c.name]));
}

async function studentClassIds(models, orgId, studentId) {
  const { Enrollment } = models;
  const rows = await Enrollment.find({
    orgId: orgOid(orgId),
    studentId,
    isActive: true,
    status: 'active',
  })
    .select('academicClassId')
    .lean();
  return rows.map((r) => r.academicClassId).filter(Boolean);
}

async function storeFile(orgId, kind, file) {
  const safeName = String(file.originalname || 'file').replace(/[^\w.\-]+/g, '_').slice(0, 120);
  const key = `tenants/${orgId}/resources/${kind}/${Date.now()}-${safeName}`;
  const storagePath = await uploadBufferToS3(file.buffer, key, file.mimetype);
  return {
    fileStoragePath: storagePath,
    fileName: file.originalname || safeName,
    fileMimeType: file.mimetype || 'application/octet-stream',
    fileSize: file.size || file.buffer?.length || 0,
  };
}

export async function listResources(models, actor, orgId, query) {
  const kind = parseKind(query.kind);
  await assertKindEnabled(orgId, kind);
  const { LearningResource } = models;
  const oid = orgOid(orgId);

  const filter = { orgId: oid, kind, ...ACTIVE };

  if (isStudent(actor)) {
    filter.isPublished = true;
    const classIds = await studentClassIds(models, orgId, actor._id);
    filter.classIds = { $in: classIds };
  } else if (!canManage(actor)) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  } else if (actor.hierarchyRole === 'subordinate') {
    filter.createdBy = actor._id;
  }

  const items = await LearningResource.find(filter).sort({ createdAt: -1 }).lean();
  const ids = [...new Set(items.flatMap((item) => (item.classIds || []).map(String)))];
  const names = await classNameMap(
    models,
    orgId,
    ids.map((id) => new mongoose.Types.ObjectId(id))
  );
  return { resources: items.map((item) => serialize(item, names)) };
}

export async function createResource(models, actor, orgId, body, file) {
  if (!canManage(actor)) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
  const kind = parseKind(body.kind);
  await assertKindEnabled(orgId, kind);

  const title = String(body.title || '').trim();
  if (!title) {
    const err = new Error('Title is required');
    err.status = 400;
    throw err;
  }
  const classIds = parseClassIds(body.classIds);
  if (!classIds.length) {
    const err = new Error('Select at least one class');
    err.status = 400;
    throw err;
  }
  if (kind === 'worksheet' && !file) {
    const err = new Error('A PDF or Word file is required');
    err.status = 400;
    throw err;
  }

  const startAt = parseDate(body.startAt);
  const endAt = parseDate(body.endAt);
  if (startAt && endAt && endAt.getTime() < startAt.getTime()) {
    const err = new Error('End must be after the start');
    err.status = 400;
    throw err;
  }

  const fileFields = file ? await storeFile(orgId, kind, file) : {};
  const { LearningResource } = models;
  const doc = await LearningResource.create({
    orgId: orgOid(orgId),
    kind,
    title,
    description: String(body.description || '').trim(),
    classIds,
    ...fileFields,
    startAt,
    endAt,
    dueAt: kind === 'assignment' ? parseDate(body.dueAt) : null,
    isPublished: parsePublished(body.isPublished),
    createdBy: actor._id,
  });

  const names = await classNameMap(models, orgId, classIds);
  return serialize(doc.toObject(), names);
}

async function loadManageable(models, actor, orgId, id) {
  const { LearningResource } = models;
  const doc = await LearningResource.findOne({ _id: id, orgId: orgOid(orgId), ...ACTIVE });
  if (!doc) {
    const err = new Error('Not found');
    err.status = 404;
    throw err;
  }
  await assertKindEnabled(orgId, doc.kind);
  if (!canManage(actor)) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
  if (actor.hierarchyRole === 'subordinate' && doc.createdBy?.toString() !== actor._id.toString()) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
  return doc;
}

export async function updateResource(models, actor, orgId, id, body, file) {
  const doc = await loadManageable(models, actor, orgId, id);
  if (body.title !== undefined) {
    const title = String(body.title || '').trim();
    if (!title) {
      const err = new Error('Title cannot be empty');
      err.status = 400;
      throw err;
    }
    doc.title = title;
  }
  if (body.description !== undefined) doc.description = String(body.description || '').trim();
  if (body.classIds !== undefined) {
    const classIds = parseClassIds(body.classIds);
    if (!classIds.length) {
      const err = new Error('Select at least one class');
      err.status = 400;
      throw err;
    }
    doc.classIds = classIds;
  }
  if (body.startAt !== undefined) doc.startAt = parseDate(body.startAt);
  if (body.endAt !== undefined) doc.endAt = parseDate(body.endAt);
  if (doc.kind === 'assignment' && body.dueAt !== undefined) doc.dueAt = parseDate(body.dueAt);
  if (body.isPublished !== undefined) doc.isPublished = parsePublished(body.isPublished);
  if (doc.startAt && doc.endAt && doc.endAt.getTime() < doc.startAt.getTime()) {
    const err = new Error('End must be after the start');
    err.status = 400;
    throw err;
  }
  if (file) {
    const prev = doc.fileStoragePath;
    const uploaded = await storeFile(orgId, doc.kind, file);
    Object.assign(doc, uploaded);
    if (prev) await deleteS3Object(prev).catch(() => {});
  }
  if (doc.kind === 'worksheet' && !doc.fileStoragePath) {
    const err = new Error('A PDF or Word file is required');
    err.status = 400;
    throw err;
  }
  await doc.save();
  const names = await classNameMap(models, orgId, doc.classIds || []);
  return serialize(doc.toObject(), names);
}

export async function deleteResource(models, actor, orgId, id) {
  const doc = await loadManageable(models, actor, orgId, id);
  doc.deletedAt = new Date();
  await doc.save();
  if (doc.fileStoragePath) await deleteS3Object(doc.fileStoragePath).catch(() => {});
  return { ok: true };
}

export async function downloadResource(models, actor, orgId, id) {
  const { LearningResource } = models;
  const doc = await LearningResource.findOne({ _id: id, orgId: orgOid(orgId), ...ACTIVE }).lean();
  if (!doc || !doc.fileStoragePath) {
    const err = new Error('File not found');
    err.status = 404;
    throw err;
  }
  await assertKindEnabled(orgId, doc.kind);

  if (isStudent(actor)) {
    if (!doc.isPublished) {
      const err = new Error('Not found');
      err.status = 404;
      throw err;
    }
    const classIds = (await studentClassIds(models, orgId, actor._id)).map(String);
    const allowed = (doc.classIds || []).some((cid) => classIds.includes(String(cid)));
    if (!allowed) {
      const err = new Error('Forbidden');
      err.status = 403;
      throw err;
    }
    const window = windowState(doc);
    if (window.isNotYetOpen) {
      const err = new Error('Download is not open yet');
      err.status = 400;
      throw err;
    }
    if (window.isClosed) {
      const err = new Error('Download is closed');
      err.status = 400;
      throw err;
    }
  } else if (!canManage(actor)) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }

  const buffer = await readStorageBytes(doc.fileStoragePath);
  return {
    buffer,
    fileName: doc.fileName || 'download',
    contentType: doc.fileMimeType || 'application/octet-stream',
  };
}
