import crypto from 'crypto';
import { AppError } from '../../utils/errors.js';
import { getTenantModels } from '../../db/tenantModels.js';
import {
  checkoutMode,
  describeAccess,
  findStudentPlan,
  listStudentPlans,
  nextPaidWindow,
  razorpayConfigured,
  TRIAL_DAYS,
} from './access.js';

function signaturesMatch(expected, received) {
  const left = Buffer.from(String(expected || ''));
  const right = Buffer.from(String(received || ''));
  if (left.length === 0 || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

async function razorpayOrder({ amountPaise, currency, receipt, notes }) {
  const key = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  const auth = Buffer.from(`${key}:${secret}`).toString('base64');
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ amount: amountPaise, currency, receipt, notes }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new AppError(data?.error?.description || 'Could not start the payment', 502);
  }
  return data;
}

export function billingStatus(user) {
  return {
    access: describeAccess(user),
    trialDays: TRIAL_DAYS,
    checkout: checkoutMode(),
    plans: listStudentPlans(),
  };
}

/**
 * Grant the paid window and mark the payment row paid. Safe to call twice for the same row.
 */
export async function grantPaidAccess(models, payment, { providerPaymentId } = {}) {
  if (payment.status === 'paid') {
    const user = await models.User.findById(payment.userId);
    return { user, access: describeAccess(user), alreadyPaid: true };
  }

  const user = await models.User.findById(payment.userId);
  if (!user) throw new AppError('Student not found for this payment', 404);

  const periodDays = Number(payment.periodDays);
  if (!periodDays) throw new AppError('Payment is missing a plan length', 500);
  const now = new Date();
  const window = nextPaidWindow(user, periodDays, now);
  user.subscriptionEndsAt = window.periodEndsAt;
  if (payment.planId) user.subscriptionPlanId = payment.planId;
  user.subscriptionSuspended = false;
  await user.save();

  payment.status = 'paid';
  payment.paidAt = now;
  payment.periodStartsAt = window.periodStartsAt;
  payment.periodEndsAt = window.periodEndsAt;
  if (providerPaymentId) payment.providerPaymentId = providerPaymentId;
  await payment.save();

  return { user, access: describeAccess(user), alreadyPaid: false };
}

export async function createCheckout(models, user, { subdomain, planId }) {
  if (user.hierarchyRole !== 'user') {
    throw new AppError('Only student accounts need a subscription', 403);
  }

  const plan = findStudentPlan(planId);
  if (!plan) throw new AppError('Choose a monthly, quarterly, or yearly plan', 400);

  const mode = checkoutMode();
  if (mode === 'unconfigured') {
    throw new AppError('Payments are not configured yet', 503);
  }

  const payment = await models.StudentPayment.create({
    orgId: user.orgId,
    userId: user._id,
    provider: mode === 'razorpay' ? 'razorpay' : 'dev',
    status: 'created',
    planId: plan.id,
    periodDays: plan.periodDays,
    amountPaise: plan.amountPaise,
    currency: plan.currency,
  });

  if (mode === 'dev') {
    payment.orderId = `dev_${payment._id.toString()}`;
    await payment.save();
    return {
      mode,
      paymentId: payment._id.toString(),
      orderId: payment.orderId,
      amountPaise: plan.amountPaise,
      currency: plan.currency,
      plan,
    };
  }

  const order = await razorpayOrder({
    amountPaise: plan.amountPaise,
    currency: plan.currency,
    receipt: payment._id.toString().slice(0, 40),
    notes: {
      subdomain,
      userId: user._id.toString(),
      paymentId: payment._id.toString(),
      planId: plan.id,
    },
  });

  payment.orderId = order.id;
  await payment.save();

  return {
    mode,
    keyId: process.env.RAZORPAY_KEY_ID,
    paymentId: payment._id.toString(),
    orderId: order.id,
    amountPaise: plan.amountPaise,
    currency: plan.currency,
    plan,
  };
}

export async function verifyRazorpayPayment(models, user, body) {
  if (!razorpayConfigured()) throw new AppError('Payments are not configured yet', 503);

  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${body.razorpay_order_id}|${body.razorpay_payment_id}`)
    .digest('hex');

  if (!signaturesMatch(expected, body.razorpay_signature)) {
    throw new AppError('Payment signature did not match', 400);
  }

  const payment = await models.StudentPayment.findOne({
    _id: body.paymentId,
    userId: user._id,
    orderId: body.razorpay_order_id,
  });
  if (!payment) throw new AppError('Payment not found', 404);

  return grantPaidAccess(models, payment, { providerPaymentId: body.razorpay_payment_id });
}

export async function activateDevPayment(models, user, paymentId) {
  if (checkoutMode() !== 'dev') {
    throw new AppError('Test checkout is only available when Razorpay is not configured', 403);
  }
  const payment = await models.StudentPayment.findOne({
    _id: paymentId,
    userId: user._id,
    provider: 'dev',
  });
  if (!payment) throw new AppError('Payment not found', 404);
  return grantPaidAccess(models, payment, { providerPaymentId: payment.orderId });
}

export async function handleRazorpayWebhook(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET;
  if (!secret) throw new AppError('Webhook secret is not configured', 503);
  if (!rawBody) throw new AppError('Missing webhook body', 400);

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  if (!signaturesMatch(expected, signature)) {
    throw new AppError('Invalid webhook signature', 400);
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new AppError('Invalid webhook payload', 400);
  }

  const paymentEntity = event?.payload?.payment?.entity;
  const notes = paymentEntity?.notes || {};
  const subdomain = notes.subdomain;
  const paymentId = notes.paymentId;
  if (!subdomain || !paymentId) return { ignored: true };

  const models = await getTenantModels(subdomain);
  const payment = await models.StudentPayment.findById(paymentId);
  if (!payment) return { ignored: true };

  if (event.event === 'payment.captured' || event.event === 'order.paid') {
    if (paymentEntity?.order_id && payment.orderId && paymentEntity.order_id !== payment.orderId) {
      throw new AppError('Order mismatch', 400);
    }
    await grantPaidAccess(models, payment, { providerPaymentId: paymentEntity?.id });
    return { ok: true };
  }

  if (event.event === 'payment.failed' && payment.status === 'created') {
    payment.status = 'failed';
    if (paymentEntity?.id) payment.providerPaymentId = paymentEntity.id;
    await payment.save();
  }

  return { ok: true };
}
