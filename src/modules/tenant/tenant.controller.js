import { asyncHandler } from '../../utils/asyncHandler.js';
import { tenantResponse } from './tenant.service.js';
import { Organization } from '../../models/Organization.js';

/** Current tenant context (from middleware). */
export const getCurrentTenant = asyncHandler(async (req, res) => {
  if (!req.tenant?.organization) {
    return res.status(400).json({ error: 'No tenant context' });
  }
  res.json({ organization: tenantResponse(req.tenant.organization) });
});

const SIDEBAR_LABEL_KEYS = [
  'dashboard',
  'subordinates',
  'users',
  'usersMember',
  'profile',
  'organization',
  'settingsNav',
  'assessments',
  'myAssessments',
  'groupStudents',
  'classes',
  'knowledgeBase',
];

export const patchOrgSettings = asyncHandler(async (req, res) => {
  const org = await Organization.findById(req.tenant.orgId);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  if (req.body.name) org.name = req.body.name;
  if (req.body.settings?.timezone !== undefined) {
    org.settings = org.settings || {};
    org.settings.timezone = req.body.settings.timezone;
  }
  if (req.body.settings?.sidebarLabels !== undefined) {
    org.settings = org.settings || {};
    const incoming = req.body.settings.sidebarLabels;
    const prev = org.settings.sidebarLabels;
    const cur =
      prev && typeof prev === 'object'
        ? { ...(typeof prev.toObject === 'function' ? prev.toObject() : prev) }
        : {};
    for (const k of SIDEBAR_LABEL_KEYS) {
      if (incoming[k] === undefined) continue;
      const v = incoming[k];
      if (v === null || v === '') delete cur[k];
      else cur[k] = String(v).trim().slice(0, 48);
    }
    org.settings.sidebarLabels = Object.keys(cur).length ? cur : undefined;
    org.markModified('settings');
  }
  await org.save();
  res.json({ organization: tenantResponse(org.toObject()) });
});
