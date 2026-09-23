import { asyncHandler } from '../../utils/asyncHandler.js';
import { getPublicTenantBranding, getPublicTenantLogoBuffer } from './public.service.js';

export const getTenantBranding = asyncHandler(async (req, res) => {
  const branding = await getPublicTenantBranding(req.params.subdomain);
  res.json({ tenant: branding });
});

export const getTenantLogo = asyncHandler(async (req, res) => {
  const { buffer, contentType } = await getPublicTenantLogoBuffer(req.params.subdomain);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.send(buffer);
});
