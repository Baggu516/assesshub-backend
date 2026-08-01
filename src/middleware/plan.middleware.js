import { AppError } from '../utils/errors.js';

/** Plans that include dashboard AI chat and knowledge base. */
export function orgHasAiFeatures(organization) {
  const plan = organization?.plan || 'ai_dashboard';
  return plan === 'ai_dashboard';
}

/** Block AI / KB routes when the tenant is on assessments-only. */
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
