/** Canonical permission keys — checked via user.permissions.includes(key). */
export const PERMISSION_KEYS = {
  USER_CREATE: 'user_create',
  SUBORDINATE_CREATE: 'subordinate_create',
  SETTINGS_MANAGE: 'settings_manage',
  ASSESSMENT_CREATE: 'assessment_create',
  ASSESSMENT_VIEW: 'assessment_view',
  ASSESSMENT_SUBMIT: 'assessment_submit',
};

export const ALL_PERMISSION_KEYS = Object.values(PERMISSION_KEYS);
