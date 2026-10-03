import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  assignStudentPlan,
  setSchoolBilling,
  setSchoolCommission,
  setStudentSuspended,
  subscriptionOverview,
  subscriptionStudents,
} from './platformSubscriptions.service.js';

function sendFresh(req, res, body) {
  delete req.headers['if-none-match'];
  delete req.headers['if-modified-since'];
  res.set('Cache-Control', 'no-store');
  res.json(body);
}

export const getSubscriptionOverview = asyncHandler(async (req, res) => {
  sendFresh(req, res, await subscriptionOverview());
});

export const getSubscriptionStudents = asyncHandler(async (req, res) => {
  sendFresh(req, res, await subscriptionStudents(req.params.orgId));
});

export const patchSchoolBilling = asyncHandler(async (req, res) => {
  if (req.body.commissionPerStudentRupees !== undefined) {
    res.json(await setSchoolCommission(req.params.orgId, req.body.commissionPerStudentRupees));
    return;
  }
  res.json(await setSchoolBilling(req.params.orgId, req.body.studentBillingEnabled));
});

export const postAssignPlan = asyncHandler(async (req, res) => {
  res.json(await assignStudentPlan(req.params.orgId, req.params.userId, req.body.planId));
});

export const postStudentAccess = asyncHandler(async (req, res) => {
  res.json(await setStudentSuspended(req.params.orgId, req.params.userId, req.body.suspended));
});
