import { Organization } from '../../models/Organization.js';
import {
  normalizeOrgFeatures,
  planFromFeatures,
} from '../../middleware/plan.middleware.js';

export async function getBySubdomain(subdomain) {
  return Organization.findOne({ subdomain: subdomain.toLowerCase(), isActive: true }).lean();
}

export function tenantResponse(org) {
  const features = normalizeOrgFeatures(org);
  return {
    id: org._id,
    name: org.name,
    subdomain: org.subdomain,
    isActive: org.isActive !== false,
    plan: planFromFeatures(features),
    features,
    settings: org.settings,
    createdAt: org.createdAt,
    updatedAt: org.updatedAt,
  };
}
