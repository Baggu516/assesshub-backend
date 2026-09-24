/** Canonical permission keys — checked via user.permissions.includes(key). */
export const PERMISSION_KEYS = {
  USER_CREATE: 'user_create',
  SUBORDINATE_CREATE: 'subordinate_create',
  SETTINGS_MANAGE: 'settings_manage',
  CLASS_MANAGE: 'class_manage',
  ASSESSMENT_CREATE: 'assessment_create',
  ASSESSMENT_VIEW: 'assessment_view',
  ASSESSMENT_SUBMIT: 'assessment_submit',
  ONLINE_EXAM_CREATE: 'online_exam_create',
  ONLINE_EXAM_VIEW: 'online_exam_view',
  ONLINE_EXAM_SUBMIT: 'online_exam_submit',
  WORKSHEET_MANAGE: 'worksheet_manage',
  WORKSHEET_VIEW: 'worksheet_view',
};

export const ALL_PERMISSION_KEYS = Object.values(PERMISSION_KEYS);
