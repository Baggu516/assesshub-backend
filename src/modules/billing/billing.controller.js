import { asyncHandler } from '../../utils/asyncHandler.js';
import { sanitizeUser } from '../auth/auth.service.js';
import {
  activateDevPayment,
  billingStatus,
  createCheckout,
  handleRazorpayWebhook,
  verifyRazorpayPayment,
} from './billing.service.js';

export const getBillingStatus = asyncHandler(async (req, res) => {
  res.json(billingStatus(req.user));
});

export const postCheckout = asyncHandler(async (req, res) => {
  const checkout = await createCheckout(req.tenantModels, req.user, {
    subdomain: req.tenant.subdomain,
    planId: req.body.planId,
  });
  res.status(201).json(checkout);
});

export const postVerifyPayment = asyncHandler(async (req, res) => {
  const result = await verifyRazorpayPayment(req.tenantModels, req.user, req.body);
  res.json({
    access: result.access,
    user: sanitizeUser(result.user),
  });
});

export const postDevActivate = asyncHandler(async (req, res) => {
  const result = await activateDevPayment(req.tenantModels, req.user, req.body.paymentId);
  res.json({
    access: result.access,
    user: sanitizeUser(result.user),
  });
});

export const postRazorpayWebhook = asyncHandler(async (req, res) => {
  const result = await handleRazorpayWebhook(req.rawBody, req.get('x-razorpay-signature'));
  res.json(result);
});
