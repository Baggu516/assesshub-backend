/**
 * Permission checks on `req.auth.permissions` (keys from constants/permissions.js).
 * Prefer permission keys over hierarchy role names for feature gates.
 */
export function requirePermission(...keys) {
  return (req, res, next) => {
    const perms = req.auth?.permissions || [];
    const ok = keys.some((k) => perms.includes(k));
    if (!ok) {
      return res.status(403).json({ error: 'Forbidden: missing required permission' });
    }
    return next();
  };
}

export function requireAllPermissions(...keys) {
  return (req, res, next) => {
    const perms = req.auth?.permissions || [];
    const ok = keys.every((k) => perms.includes(k));
    if (!ok) {
      return res.status(403).json({ error: 'Forbidden: missing required permissions' });
    }
    return next();
  };
}
