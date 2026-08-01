import { Organization } from '../../models/Organization.js';

export async function getBySubdomain(subdomain) {
  return Organization.findOne({ subdomain: subdomain.toLowerCase(), isActive: true }).lean();
}

export function tenantResponse(org) {
  return {
    id: org._id,
    name: org.name,
    subdomain: org.subdomain,
    isActive: org.isActive !== false,
    plan: org.plan || 'ai_dashboard',
    settings: org.settings,
    createdAt: org.createdAt,
    updatedAt: org.updatedAt,
  };
}
