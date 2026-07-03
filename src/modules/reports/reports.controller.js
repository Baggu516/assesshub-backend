import { asyncHandler } from '../../utils/asyncHandler.js';
import { dashboardForActor, activityFeed } from './reports.service.js';
import { z } from 'zod';

const feedQuery = z.object({
  page: z.coerce.number().min(1).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
});

export const getDashboard = asyncHandler(async (req, res) => {
  const data = await dashboardForActor(req.tenantModels, req.user, req.tenant.orgId);
  res.json(data);
});

export const getActivity = asyncHandler(async (req, res) => {
  const q = feedQuery.parse(req.query);
  const data = await activityFeed(req.tenantModels, req.tenant.orgId, q);
  res.json(data);
});
