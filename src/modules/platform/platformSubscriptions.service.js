import mongoose from 'mongoose';
import { Organization } from '../../models/Organization.js';
import { getTenantModels } from '../../db/tenantModels.js';
import { invalidateOrgCache } from '../../cache/orgCache.js';
import { AppError } from '../../utils/errors.js';
import { describeAccess, findStudentPlan, listStudentPlans } from '../billing/access.js';
import { grantPaidAccess } from '../billing/billing.service.js';

/** Current calendar month in India, so “this month” matches the school day. */
function indiaMonthRange(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const shift = (5 * 60 + 30) * 60 * 1000;
  const start = new Date(Date.UTC(year, month - 1, 1) - shift);
  const end = new Date(Date.UTC(year, month, 1) - shift);
  return { start, end };
}

function emptyCounts() {
  return {
    students: 0,
    active: 0,
    trial: 0,
    expired: 0,
    pending: 0,
    suspended: 0,
    paidThisMonth: 0,
    collectedThisMonthPaise: 0,
  };
}

function studentName(user) {
  return [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
}

async function loadClientBundle(org, month) {
  const orgId = org._id;
  const models = await getTenantModels(org.subdomain);
  const [users, payments, monthPayments] = await Promise.all([
    models.User.find({ orgId, hierarchyRole: 'user' })
      .select(
        'email registrationId firstName lastName isActive trialEndsAt subscriptionEndsAt subscriptionPlanId subscriptionSuspended createdAt'
      )
      .sort({ firstName: 1, lastName: 1, email: 1 })
      .lean(),
    models.StudentPayment.aggregate([
      { $match: { orgId: new mongoose.Types.ObjectId(String(orgId)), status: 'paid' } },
      { $sort: { paidAt: -1 } },
      {
        $group: {
          _id: '$userId',
          paidAt: { $first: '$paidAt' },
          provider: { $first: '$provider' },
          planId: { $first: '$planId' },
          amountPaise: { $first: '$amountPaise' },
        },
      },
    ]),
    models.StudentPayment.find({
      orgId,
      status: 'paid',
      provider: { $in: ['razorpay', 'dev'] },
      paidAt: { $gte: month.start, $lt: month.end },
    })
      .select('userId amountPaise')
      .lean(),
  ]);

  const lastByUser = new Map(payments.map((row) => [String(row._id), row]));
  const paidThisMonth = new Set(monthPayments.map((row) => String(row.userId)));
  const counts = emptyCounts();
  counts.students = users.length;
  counts.paidThisMonth = paidThisMonth.size;
  counts.collectedThisMonthPaise = monthPayments.reduce(
    (sum, row) => sum + (Number(row.amountPaise) || 0),
    0
  );

  const students = users.map((user) => {
    const access = describeAccess(user);
    if (access.status === 'active') counts.active += 1;
    else if (access.status === 'trial') counts.trial += 1;
    else if (access.status === 'expired') counts.expired += 1;
    else if (access.status === 'pending') counts.pending += 1;
    else if (access.status === 'suspended') counts.suspended += 1;

    const last = lastByUser.get(String(user._id));
    return {
      id: String(user._id),
      email: user.email,
      registrationId: user.registrationId || null,
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      name: studentName(user),
      isActive: user.isActive !== false,
      access,
      paidThisMonth: paidThisMonth.has(String(user._id)),
      lastPayment: last
        ? {
            paidAt: last.paidAt,
            provider: last.provider,
            planId: last.planId || null,
            amountPaise: last.amountPaise,
          }
        : null,
    };
  });

  return { counts, students };
}

function clientSummary(org, counts, loadError) {
  return {
    id: String(org._id),
    name: org.name,
    subdomain: org.subdomain,
    logoUrl: org.logoUrl || null,
    isActive: org.isActive !== false,
    studentBillingEnabled: org.studentBillingEnabled !== false,
    loadError: Boolean(loadError),
    ...counts,
    commissionPerStudentPaise: Math.max(0, Number(org.commissionPerStudentPaise) || 0),
    commissionThisMonthPaise:
      (counts.paidThisMonth || 0) * Math.max(0, Number(org.commissionPerStudentPaise) || 0),
  };
}

export async function subscriptionOverview() {
  const month = indiaMonthRange();
  const orgs = await Organization.find({ subdomain: { $ne: 'master' } }).sort({ name: 1 }).lean();
  const insights = {
    ...emptyCounts(),
    clients: orgs.length,
    billingOn: orgs.filter((org) => org.studentBillingEnabled !== false).length,
    collectedThisMonthPaise: 0,
    commissionThisMonthPaise: 0,
  };

  const clients = await Promise.all(
    orgs.map(async (org) => {
      try {
        const { counts } = await loadClientBundle(org, month);
        insights.students += counts.students;
        insights.active += counts.active;
        insights.trial += counts.trial;
        insights.expired += counts.expired;
        insights.pending += counts.pending;
        insights.suspended += counts.suspended;
        insights.paidThisMonth += counts.paidThisMonth;
        insights.collectedThisMonthPaise += counts.collectedThisMonthPaise;
        const summary = clientSummary(org, counts, false);
        insights.commissionThisMonthPaise += summary.commissionThisMonthPaise;
        return summary;
      } catch (err) {
        console.error('[subscriptions] client load failed', org.subdomain, err?.message || err);
        return clientSummary(org, emptyCounts(), true);
      }
    })
  );

  return {
    monthStart: month.start.toISOString(),
    plans: listStudentPlans(),
    insights,
    clients,
  };
}

async function requireClient(orgId) {
  if (!mongoose.isValidObjectId(orgId)) throw new AppError('Client not found', 404);
  const org = await Organization.findOne({ _id: orgId, subdomain: { $ne: 'master' } });
  if (!org) throw new AppError('Client not found', 404);
  return org;
}

export async function subscriptionStudents(orgId) {
  const org = await requireClient(orgId);
  const month = indiaMonthRange();
  try {
    const { counts, students } = await loadClientBundle(org, month);
    return {
      organization: clientSummary(org, counts, false),
      students,
    };
  } catch (err) {
    console.error('[subscriptions] student load failed', org.subdomain, err?.message || err);
    throw new AppError('Could not load students for this client', 503);
  }
}

export async function setSchoolBilling(orgId, enabled) {
  const org = await requireClient(orgId);
  org.studentBillingEnabled = enabled;
  await org.save();
  await invalidateOrgCache({ subdomain: org.subdomain, orgId: org._id });
  return {
    id: String(org._id),
    studentBillingEnabled: org.studentBillingEnabled !== false,
  };
}

/** Rupees the school earns for each student who paid this month. */
export async function setSchoolCommission(orgId, rupees) {
  const amount = Number(rupees);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100000) {
    throw new AppError('Enter a commission from ₹0 to ₹100,000 per paid student', 400);
  }
  const org = await requireClient(orgId);
  org.commissionPerStudentPaise = Math.round(amount * 100);
  await org.save();
  await invalidateOrgCache({ subdomain: org.subdomain, orgId: org._id });
  return {
    id: String(org._id),
    commissionPerStudentPaise: org.commissionPerStudentPaise,
  };
}

async function requireStudent(org, userId) {
  if (!mongoose.isValidObjectId(userId)) throw new AppError('Student not found', 404);
  const models = await getTenantModels(org.subdomain);
  const user = await models.User.findOne({
    _id: userId,
    orgId: org._id,
    hierarchyRole: 'user',
  });
  if (!user) throw new AppError('Student not found', 404);
  return { models, user };
}

export async function assignStudentPlan(orgId, userId, planId) {
  const org = await requireClient(orgId);
  const plan = findStudentPlan(planId);
  if (!plan) throw new AppError('Choose a monthly, quarterly, or yearly plan', 400);
  const { models, user } = await requireStudent(org, userId);

  const payment = await models.StudentPayment.create({
    orgId: org._id,
    userId: user._id,
    provider: 'master',
    status: 'created',
    planId: plan.id,
    periodDays: plan.periodDays,
    amountPaise: plan.amountPaise,
    currency: plan.currency,
    orderId: `master_${user._id.toString()}_${Date.now()}`,
  });

  const result = await grantPaidAccess(models, payment, { providerPaymentId: 'master' });
  return { access: describeAccess(result.user), plan };
}

export async function setStudentSuspended(orgId, userId, suspended) {
  const org = await requireClient(orgId);
  const { user } = await requireStudent(org, userId);
  user.subscriptionSuspended = suspended;
  await user.save();
  return { access: describeAccess(user) };
}
