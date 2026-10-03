import { Router } from 'express';
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { validateBody } from '../../middleware/validate.middleware.js';
import { checkoutSchema, devActivateSchema, verifyPaymentSchema } from './billing.schemas.js';
import {
  getBillingStatus,
  postCheckout,
  postDevActivate,
  postRazorpayWebhook,
  postVerifyPayment,
} from './billing.controller.js';

const r = Router();

r.post('/webhook', postRazorpayWebhook);
r.get('/status', tenantMiddleware, requireAuth, getBillingStatus);
r.post('/checkout', tenantMiddleware, requireAuth, validateBody(checkoutSchema), postCheckout);
r.post('/verify', tenantMiddleware, requireAuth, validateBody(verifyPaymentSchema), postVerifyPayment);
r.post('/dev-activate', tenantMiddleware, requireAuth, validateBody(devActivateSchema), postDevActivate);

export default r;
