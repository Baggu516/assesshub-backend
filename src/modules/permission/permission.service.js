import { ALL_PERMISSION_KEYS } from '../../constants/permissions.js';

export async function listPermissions(models) {
  return models.Permission.find().sort({ key: 1 }).lean();
}

export function validatePermissionKeys(keys) {
  if (!Array.isArray(keys)) return false;
  return keys.every((k) => ALL_PERMISSION_KEYS.includes(k));
}
