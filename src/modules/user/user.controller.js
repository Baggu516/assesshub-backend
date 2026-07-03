import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  listUsers,
  listSubordinates,
  createSubordinate,
  createMember,
  updateUser,
  inviteUser,
} from './user.service.js';

export const getUsers = asyncHandler(async (req, res) => {
  const { search, page, limit } = req.query;
  const result = await listUsers(req.tenantModels, req.tenant.orgId, req.user, {
    search,
    page: page ? Number(page) : 1,
    limit: limit ? Number(limit) : 20,
  });
  res.json(result);
});

export const getSubordinates = asyncHandler(async (req, res) => {
  const rows = await listSubordinates(req.tenantModels, req.tenant.orgId, req.user._id);
  res.json({ subordinates: rows });
});

export const postSubordinate = asyncHandler(async (req, res) => {
  const row = await createSubordinate(req.tenantModels, req.user, req.tenant.orgId, req.body);
  res.status(201).json({ user: row });
});

export const postMember = asyncHandler(async (req, res) => {
  const result = await createMember(req.tenantModels, req.user, req.tenant.orgId, req.body);
  res.status(201).json(result);
});

export const patchUser = asyncHandler(async (req, res) => {
  const row = await updateUser(req.tenantModels, req.user, req.tenant.orgId, req.params.id, req.body);
  res.json({ user: row });
});

export const postInvite = asyncHandler(async (req, res) => {
  const result = await inviteUser(req.tenantModels, req.user, req.tenant.orgId, req.body, process.env.FRONTEND_URL);
  res.status(201).json(result);
});
