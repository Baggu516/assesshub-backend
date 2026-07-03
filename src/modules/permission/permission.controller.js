import { asyncHandler } from '../../utils/asyncHandler.js';
import { listPermissions } from './permission.service.js';

export const getPermissions = asyncHandler(async (req, res) => {
  const rows = await listPermissions(req.tenantModels);
  res.json({ permissions: rows });
});
