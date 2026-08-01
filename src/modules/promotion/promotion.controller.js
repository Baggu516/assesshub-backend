import { asyncHandler } from '../../utils/asyncHandler.js';
import { previewPromotion, executePromotion } from './promotion.service.js';

export const postPreview = asyncHandler(async (req, res) => {
  const result = await previewPromotion(req.tenantModels, req.user, req.tenant.orgId, req.body);
  res.json(result);
});

export const postExecute = asyncHandler(async (req, res) => {
  const result = await executePromotion(
    req.tenantModels,
    req.user,
    req.tenant.orgId,
    req.body,
    req.ip
  );
  res.json(result);
});
