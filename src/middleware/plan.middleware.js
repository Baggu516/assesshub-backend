import { AppError } from '../utils/errors.js';

/** Master console is not a paid plan. Every product flag stays on. */
export const ALL_ORG_FEATURES = {
  aiDashboard: true,
  aiAssessmentCreate: true,
  worksheets: true,
  assessments: true,
  onlineExams: true,
};

/**
 * Resolve org feature flags.
 * Legacy documents that never stored the newer keys keep the product they already had:
 * online exams on (the previous assessment/assignment flow), assessments off until enabled.
 * `plan === 'ai_dashboard'` still maps to aiDashboard when `features` was never stored.
 */
export function normalizeOrgFeatures(organization) {
  const empty = {
    aiDashboard: false,
    aiAssessmentCreate: false,
    worksheets: false,
    assessments: false,
    onlineExams: true,
  };

  if (!organization) {
    return { ...empty, onlineExams: false };
  }

  if (String(organization.subdomain || '').toLowerCase() === 'master') {
    return { ...ALL_ORG_FEATURES };
  }

  const doc = organization._doc || organization;
  const hasStoredFeatures =
    Object.prototype.hasOwnProperty.call(doc, 'features') && doc.features != null;
  const raw = hasStoredFeatures ? doc.features : null;

  if (raw) {
    const has = (key) => Object.prototype.hasOwnProperty.call(raw, key);
    return {
      aiDashboard: raw.aiDashboard === true,
      aiAssessmentCreate: raw.aiAssessmentCreate === true,
      worksheets: has('worksheets') ? raw.worksheets === true : false,
      assessments: has('assessments') ? raw.assessments === true : false,
      onlineExams: has('onlineExams') ? raw.onlineExams === true : true,
    };
  }

  return {
    ...empty,
    aiDashboard: organization.plan === 'ai_dashboard',
  };
}

export function planFromFeatures(features) {
  return features?.aiDashboard ? 'ai_dashboard' : 'assessments_only';
}

/** Plans / features that include dashboard AI chat and knowledge base. */
export function orgHasAiFeatures(organization) {
  return normalizeOrgFeatures(organization).aiDashboard;
}

/** Create-assessment-with-AI entitlement (assessments and online exams). */
export function orgHasAiAssessmentCreate(organization) {
  return normalizeOrgFeatures(organization).aiAssessmentCreate;
}

export function orgHasFeature(organization, key) {
  return normalizeOrgFeatures(organization)[key] === true;
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

const FEATURE_LABELS = {
  worksheets: 'Worksheets',
  assessments: 'Assessments',
  onlineExams: 'Online exams',
  aiDashboard: 'AI on dashboard',
  aiAssessmentCreate: 'Create with AI',
};

export function requireOrgFeature(key) {
  return (req, _res, next) => {
    if (!orgHasFeature(req.tenant?.organization, key)) {
      const label = FEATURE_LABELS[key] || 'This feature';
      return next(new AppError(`${label} is not included in this organization plan.`, 403));
    }
    return next();
  };
}
