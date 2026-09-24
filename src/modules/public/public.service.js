import { Organization } from '../../models/Organization.js';
import { AppError } from '../../utils/errors.js';
import { isReservedSubdomain } from '../../utils/reservedSubdomains.js';
import { downloadS3ToBuffer, isS3StoragePath, resolveStoredLogoUrl } from '../../utils/s3.js';
import { normalizeOrgFeatures } from '../../middleware/plan.middleware.js';

export function serializePublicBranding(org) {
  const logoUrl = resolveStoredLogoUrl(org);
  return {
    name: org.name,
    subdomain: org.subdomain,
    logoUrl,
    tagline: org.tagline || null,
    isActive: org.isActive !== false,
    features: normalizeOrgFeatures(org),
  };
}

export async function getPublicTenantBranding(subdomainRaw) {
  const subdomain = String(subdomainRaw || '')
    .trim()
    .toLowerCase();

  if (!subdomain || subdomain.length < 2) {
    throw new AppError('Invalid subdomain', 400);
  }
  if (isReservedSubdomain(subdomain)) {
    throw new AppError('Tenant not found', 404);
  }

  const org = await Organization.findOne({ subdomain }).lean();
  if (!org || org.isActive === false) {
    throw new AppError('Tenant not found', 404);
  }

  const logoUrl = resolveStoredLogoUrl(org);
  if (logoUrl && org.logoUrl !== logoUrl) {
    await Organization.updateOne({ _id: org._id }, { $set: { logoUrl } });
    org.logoUrl = logoUrl;
  }

  return serializePublicBranding(org);
}

export async function getPublicTenantLogoBuffer(subdomainRaw) {
  const subdomain = String(subdomainRaw || '')
    .trim()
    .toLowerCase();
  if (!subdomain || isReservedSubdomain(subdomain)) {
    throw new AppError('Logo not found', 404);
  }

  const org = await Organization.findOne({ subdomain, isActive: { $ne: false } })
    .select('logoStoragePath logoUrl')
    .lean();
  if (!org?.logoStoragePath || !isS3StoragePath(org.logoStoragePath)) {
    throw new AppError('Logo not found', 404);
  }

  const buffer = await downloadS3ToBuffer(org.logoStoragePath);
  const key = org.logoStoragePath.split('/').pop() || '';
  const ext = key.includes('.') ? key.slice(key.lastIndexOf('.') + 1).toLowerCase() : '';
  const contentType =
    ext === 'png'
      ? 'image/png'
      : ext === 'jpg' || ext === 'jpeg'
        ? 'image/jpeg'
        : ext === 'webp'
          ? 'image/webp'
          : ext === 'gif'
            ? 'image/gif'
            : ext === 'svg'
              ? 'image/svg+xml'
              : 'application/octet-stream';

  return { buffer, contentType };
}
