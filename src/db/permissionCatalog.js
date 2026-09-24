import mongoose from 'mongoose';

/**
 * Source of truth for every tenant.
 * Stored in the registry database (`PermissionCatalog`) and copied into each tenant.
 * `feature` null means the permission is always available.
 * `roles` are the hierarchy roles that may be given this permission.
 */
export const PERMISSION_CATALOG = [
  {
    key: 'user_create',
    label: 'Create students',
    description: 'Invite or create students',
    feature: null,
    roles: ['admin'],
  },
  {
    key: 'subordinate_create',
    label: 'Create teachers',
    description: 'Add teachers',
    feature: null,
    roles: ['admin'],
  },
  {
    key: 'settings_manage',
    label: 'Manage settings',
    description: 'Organization settings',
    feature: null,
    roles: ['admin'],
  },
  {
    key: 'class_manage',
    label: 'Manage classes',
    description: 'Create classes and assign teachers and students',
    feature: null,
    roles: ['admin'],
  },
  {
    key: 'assessment_create',
    label: 'Create assessments',
    description: 'Build and assign assessments',
    feature: 'assessments',
    roles: ['admin', 'subordinate'],
  },
  {
    key: 'assessment_view',
    label: 'View assessments',
    description: 'Open assigned assessments',
    feature: 'assessments',
    roles: ['admin', 'subordinate', 'user'],
  },
  {
    key: 'assessment_submit',
    label: 'Submit assessments',
    description: 'Take and submit assessments',
    feature: 'assessments',
    roles: ['admin', 'user'],
  },
  {
    key: 'online_exam_create',
    label: 'Create online exams',
    description: 'Build and assign online exams',
    feature: 'onlineExams',
    roles: ['admin', 'subordinate'],
  },
  {
    key: 'online_exam_view',
    label: 'View online exams',
    description: 'Open assigned online exams',
    feature: 'onlineExams',
    roles: ['admin', 'subordinate', 'user'],
  },
  {
    key: 'online_exam_submit',
    label: 'Submit online exams',
    description: 'Take and submit online exams',
    feature: 'onlineExams',
    roles: ['admin', 'user'],
  },
  {
    key: 'worksheet_manage',
    label: 'Manage worksheets',
    description: 'Create and share worksheets',
    feature: 'worksheets',
    roles: ['admin', 'subordinate'],
  },
  {
    key: 'worksheet_view',
    label: 'View worksheets',
    description: 'Open worksheets shared with the class',
    feature: 'worksheets',
    roles: ['admin', 'subordinate', 'user'],
  },
];

const permissionCatalogSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    label: { type: String, required: true },
    description: { type: String, default: '' },
    feature: { type: String, default: null },
    roles: [{ type: String }],
  },
  { timestamps: true, collection: 'permission_catalog' }
);

export const PermissionCatalog =
  mongoose.models.PermissionCatalog || mongoose.model('PermissionCatalog', permissionCatalogSchema);

export function keysForRole(role) {
  return PERMISSION_CATALOG.filter((row) => row.roles.includes(role)).map((row) => row.key);
}

export function permissionAllowedForRole(key, role) {
  const row = PERMISSION_CATALOG.find((item) => item.key === key);
  return Boolean(row && row.roles.includes(role));
}

/** Upsert the shared catalog in the registry database. */
export async function ensureMasterPermissionCatalog() {
  for (const row of PERMISSION_CATALOG) {
    await PermissionCatalog.updateOne({ key: row.key }, { $set: row }, { upsert: true });
  }
  await PermissionCatalog.deleteMany({ key: { $nin: PERMISSION_CATALOG.map((row) => row.key) } });
}

/** Rows to copy into a tenant. Prefer the registry collection, then the code list. */
export async function loadMasterPermissionCatalog() {
  const rows = await PermissionCatalog.find().lean();
  if (rows.length) {
    return rows.map((row) => ({
      key: row.key,
      label: row.label,
      description: row.description || '',
      feature: row.feature || null,
      roles: Array.isArray(row.roles) ? row.roles : [],
    }));
  }
  return PERMISSION_CATALOG;
}
