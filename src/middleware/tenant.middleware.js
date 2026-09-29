import { getTenantModels } from '../db/tenantModels.js';
import { ensureTenantCatalog } from '../db/tenantCatalog.js';
import { resolveSubdomainFromRequest } from '../utils/tenant.js';
import { getActiveOrgBySubdomain } from '../cache/orgCache.js';

async function attachTenant(req, subdomain) {
  const organization = await getActiveOrgBySubdomain(subdomain);
  if (!organization) return false;

  const models = await getTenantModels(subdomain);
  await ensureTenantCatalog(models, subdomain);

  req.tenantModels = models;
  req.tenant = {
    orgId: organization._id.toString(),
    subdomain: organization.subdomain,
    organization,
  };
  return true;
}

/**
 * Resolves tenant from subdomain and attaches req.tenant and req.tenantModels.
 * Must run before authenticated routes that need org context.
 */
export async function tenantMiddleware(req, res, next) {
  try {
    const subdomain = resolveSubdomainFromRequest(req);
    if (!subdomain) {
      return res.status(400).json({
        error: 'Tenant not specified. Use organization subdomain or X-Tenant-Subdomain header.',
      });
    }

    const ok = await attachTenant(req, subdomain);
    if (!ok) {
      return res.status(404).json({ error: 'Organization not found for this subdomain' });
    }
    return next();
  } catch (e) {
    return next(e);
  }
}

/** Optional tenant for public routes that still need org when subdomain present */
export async function optionalTenantMiddleware(req, res, next) {
  try {
    const subdomain = resolveSubdomainFromRequest(req);
    if (!subdomain) {
      req.tenant = null;
      req.tenantModels = null;
      return next();
    }
    const ok = await attachTenant(req, subdomain);
    if (!ok) {
      req.tenant = null;
      req.tenantModels = null;
    }
    return next();
  } catch (e) {
    return next(e);
  }
}
