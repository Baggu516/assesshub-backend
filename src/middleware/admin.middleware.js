/** Organization administrator only (`hierarchyRole === 'admin'`). */
export function requireOrgAdmin(req, res, next) {
  if (req.user?.hierarchyRole !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: organization administrators only' });
  }
  return next();
}
