import { Router } from 'express';
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { validateBody } from '../../middleware/validate.middleware.js';
import { previewPromotionSchema, executePromotionSchema } from './promotion.schemas.js';
import { postPreview, postExecute } from './promotion.controller.js';

const r = Router();

r.use(tenantMiddleware, requireAuth);

r.post('/preview', validateBody(previewPromotionSchema), postPreview);
r.post('/execute', validateBody(executePromotionSchema), postExecute);

export default r;
