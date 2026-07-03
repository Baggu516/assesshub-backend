import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  registerOrganization,
  login,
  refreshSession,
  logout,
  sanitizeUser,
  acceptInvite,
} from './auth.service.js';
export const registerOrg = asyncHandler(async (req, res) => {
  const result = await registerOrganization(req.body);
  res.status(201).json(result);
});

export const loginUser = asyncHandler(async (req, res) => {
  const orgId = req.tenant.orgId;
  const tokens = await login(
    {
      email: req.body.email,
      password: req.body.password,
      orgId,
    },
    req
  );
  res.json(tokens);
});

export const refresh = asyncHandler(async (req, res) => {
  const tokens = await refreshSession({ refreshToken: req.body.refreshToken, req });
  res.json(tokens);
});

export const logoutUser = asyncHandler(async (req, res) => {
  await logout({ refreshToken: req.body.refreshToken });
  res.status(204).send();
});

export const me = asyncHandler(async (req, res) => {
  const user = await req.tenantModels.User.findById(req.user._id).populate('roleId').lean();
  res.json({ user: sanitizeUser(user) });
});

export const acceptInviteHandler = asyncHandler(async (req, res) => {
  const tokens = await acceptInvite(
    {
      token: req.body.token,
      password: req.body.password,
      orgId: req.tenant.orgId,
    },
    req.tenantModels
  );
  res.json(tokens);
});
