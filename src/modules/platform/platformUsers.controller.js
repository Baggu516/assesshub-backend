import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  createPlatformUser as createPlatformUserService,
  deletePlatformUserById,
  getPlatformUserById,
  listPlatformUsers as listPlatformUsersService,
  patchPlatformUserById,
} from './platformUsers.service.js';

export const listPlatformUsers = asyncHandler(async (_req, res) => {
  res.json({ users: await listPlatformUsersService() });
});

export const getPlatformUser = asyncHandler(async (req, res) => {
  res.json({ user: await getPlatformUserById(req.params.id) });
});

export const createPlatformUser = asyncHandler(async (req, res) => {
  const user = await createPlatformUserService(req.body);
  res.status(201).json({ user });
});

export const patchPlatformUser = asyncHandler(async (req, res) => {
  res.json({ user: await patchPlatformUserById(req.params.id, req.body) });
});

export const deletePlatformUser = asyncHandler(async (req, res) => {
  await deletePlatformUserById(req.params.id);
  res.status(204).send();
});
