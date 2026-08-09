import { AppError } from '../utils/errors.js';

/**
 * Resolve org feature flags. Legacy `plan === 'ai_dashboard'` maps to aiDashboard
 * when `features` was never stored on the document.
 */
export function normalizeOrgFeatures(organization) {
  if (!organization) {
    return { aiDashboard: false, aiAssessmentCreate: false };
  }

  const doc = organization._doc || organization;
  const hasStoredFeatures =
    Object.prototype.hasOwnProperty.call(doc, 'features') && doc.features != null;
  const raw = hasStoredFeatures ? doc.features : null;

  if (raw) {
    return {
      aiDashboard: raw.aiDashboard === true,
      aiAssessmentCreate: raw.aiAssessmentCreate === true,
    };
  }

  return {
    aiDashboard: organization.plan === 'ai_dashboard',
    aiAssessmentCreate: false,
  };
}

export function planFromFeatures(features) {
  return features?.aiDashboard ? 'ai_dashboard' : 'assessments_only';
}

/** Plans / features that include dashboard AI chat and knowledge base. */
export function orgHasAiFeatures(organization) {
  return normalizeOrgFeatures(organization).aiDashboard;
}

/** Create-assessment-with-AI entitlement. */
export function orgHasAiAssessmentCreate(organization) {
  return normalizeOrgFeatures(organization).aiAssessmentCreate;
}

/** Block AI / KB routes when the tenant lacks dashboard AI. */
export function requireAiPlan(req, _res, next) {
  if (!orgHasAiFeatures(req.tenant?.organization)) {
    return next(
      new AppError(
        'AI features are not included in this organization plan. Upgrade to AI dashboard.',
        403
      )
    );
  }
  return next();
}

/** Block AI assessment-generation routes when that add-on is off. */
export function requireAiAssessmentCreate(req, _res, next) {
  if (!orgHasAiAssessmentCreate(req.tenant?.organization)) {
    return next(
      new AppError(
        'Create assessment with AI is not included in this organization plan.',
        403
      )
    );
  }
  return next();
}
