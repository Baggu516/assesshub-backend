import { ALL_PERMISSION_KEYS } from '../../constants/permissions.js';

export async function listPermissions(models) {
  const rows = await models.Permission.find().sort({ key: 1 }).lean();
  return rows.map((row) => ({
    key: row.key,
    label: row.label,
    description: row.description || '',
    feature: row.feature || null,
    roles: Array.isArray(row.roles) ? row.roles : [],
  }));
}

/** Validate an array of permission keys against the catalog. */
export function validatePermissionKeys(keys) {
  if (!Array.isArray(keys)) return false;
  return keys.every((k) => ALL_PERMISSION_KEYS.includes(k));
}
