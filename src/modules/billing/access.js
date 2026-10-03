/** Students (`hierarchyRole === 'user'`) get this many days before payment is required. */
export const TRIAL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
export const TRIAL_MS = TRIAL_DAYS * DAY_MS;

/** Prices are rupees stored as paise. */
export const STUDENT_PLANS = [
  { id: 'monthly', label: 'Monthly', amountPaise: 14900, periodDays: 30, currency: 'INR' },
  { id: 'quarterly', label: 'Quarterly', amountPaise: 40000, periodDays: 90, currency: 'INR' },
  { id: 'yearly', label: 'Yearly', amountPaise: 129900, periodDays: 365, currency: 'INR' },
];

export function listStudentPlans() {
  return STUDENT_PLANS.map((plan) => ({ ...plan, trialDays: TRIAL_DAYS }));
}

export function findStudentPlan(planId) {
  return listStudentPlans().find((plan) => plan.id === planId) || null;
}

export function razorpayConfigured() {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

/** `dev` lets local checkout mark a student paid without Razorpay keys. */
export function checkoutMode() {
  if (razorpayConfigured()) return 'razorpay';
  if (process.env.NODE_ENV !== 'production') return 'dev';
  return 'unconfigured';
}

function daysUntil(until, now) {
  const ms = until.getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / DAY_MS);
}

function asDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isStudentUser(user) {
  return user?.hierarchyRole === 'user';
}

/**
 * Start the 7-day clock once. Existing students with no trial date get it on first sign-in,
 * so a deploy does not lock accounts that were created before billing existed.
 * @returns {boolean} true when the document was changed and still needs saving
 */
export function stampStudentTrial(user, now = new Date()) {
  if (!isStudentUser(user) || user.trialEndsAt) return false;
  user.trialStartedAt = now;
  user.trialEndsAt = new Date(now.getTime() + TRIAL_MS);
  return true;
}

/**
 * Paid time is stacked after any access the student already has (remaining trial or an active period).
 */
export function nextPaidWindow(user, periodDays, now = new Date()) {
  const trialEnd = asDate(user?.trialEndsAt);
  const paidEnd = asDate(user?.subscriptionEndsAt);
  let start = now;
  if (paidEnd && paidEnd.getTime() > start.getTime()) start = paidEnd;
  else if (trialEnd && trialEnd.getTime() > start.getTime()) start = trialEnd;
  const periodEndsAt = new Date(start.getTime() + periodDays * DAY_MS);
  return { periodStartsAt: start, periodEndsAt };
}

/** Derived access snapshot. Missing trial on a student is `pending` until `stampStudentTrial` runs. */
export function describeAccess(user, now = new Date(), options = {}) {
  const billingEnabled = options.billingEnabled !== false;
  const planId = user?.subscriptionPlanId || null;

  if (!isStudentUser(user)) {
    return {
      required: false,
      status: 'exempt',
      locked: false,
      daysLeft: null,
      trialEndsAt: null,
      subscriptionEndsAt: null,
      planId: null,
      suspended: false,
    };
  }

  const trialEndsAt = asDate(user.trialEndsAt);
  const subscriptionEndsAt = asDate(user.subscriptionEndsAt);
  const dates = {
    planId,
    suspended: user.subscriptionSuspended === true,
    trialEndsAt: trialEndsAt ? trialEndsAt.toISOString() : null,
    subscriptionEndsAt: subscriptionEndsAt ? subscriptionEndsAt.toISOString() : null,
  };

  if (user.subscriptionSuspended === true) {
    return { required: true, status: 'suspended', locked: true, daysLeft: 0, ...dates };
  }

  if (!billingEnabled) {
    return { required: false, status: 'waived', locked: false, daysLeft: null, ...dates, suspended: false };
  }

  const paidActive = Boolean(subscriptionEndsAt && subscriptionEndsAt.getTime() > now.getTime());

  if (paidActive) {
    return {
      required: true,
      status: 'active',
      locked: false,
      daysLeft: daysUntil(subscriptionEndsAt, now),
      ...dates,
    };
  }

  if (!trialEndsAt) {
    return {
      required: true,
      status: 'pending',
      locked: false,
      daysLeft: TRIAL_DAYS,
      ...dates,
    };
  }

  if (trialEndsAt.getTime() > now.getTime()) {
    return {
      required: true,
      status: 'trial',
      locked: false,
      daysLeft: daysUntil(trialEndsAt, now),
      ...dates,
    };
  }

  return {
    required: true,
    status: 'expired',
    locked: true,
    daysLeft: 0,
    ...dates,
  };
}
