import { Router } from 'express';
import { getTenantBranding, getTenantLogo } from './public.controller.js';

const r = Router();

r.get('/tenants/:subdomain', getTenantBranding);
r.get('/tenants/:subdomain/logo', getTenantLogo);

export default r;
