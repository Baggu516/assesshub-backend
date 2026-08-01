const catalogVersionBySubdomain = new Map();
/** Bump when permission seeds / default role perms change so tenants re-sync in-process. */
const CATALOG_VERSION = 3;

const LEGACY_TASK_PERMS = ['task_create', 'task_view', 'task_update', 'task_delete'];

/**
 * Idempotent: seeds Permission docs and legacy cleanup once per tenant catalog version.
 */
export async function ensureTenantCatalog(models, subdomain) {
  if (catalogVersionBySubdomain.get(subdomain) === CATALOG_VERSION) return;

  const seeds = [
    { key: 'user_create', label: 'Create students', description: 'Invite or create students (admin)' },
    { key: 'subordinate_create', label: 'Create teachers', description: 'Add teachers under admin' },
    { key: 'settings_manage', label: 'Manage settings', description: 'Organization settings' },
    { key: 'class_manage', label: 'Manage classes', description: 'Create classes and assign teachers/students' },
    { key: 'assessment_create', label: 'Create assessments', description: 'Build and assign assessments' },
    { key: 'assessment_view', label: 'View assessments', description: 'View assigned or created assessments' },
    { key: 'assessment_submit', label: 'Submit assessments', description: 'Take and submit assessments' },
  ];

  const { Permission, Role, User } = models;

  for (const s of seeds) {
    await Permission.updateOne({ key: s.key }, { $set: s }, { upsert: true });
  }

  await Permission.deleteMany({ key: { $in: LEGACY_TASK_PERMS } });

  /** Teachers view class students and run assessments — they do not create student accounts. */
  const teacherPerms = ['assessment_create', 'assessment_view'];
  const studentPerms = ['assessment_view', 'assessment_submit'];
  const adminPerms = [
    'subordinate_create',
    'user_create',
    'settings_manage',
    'class_manage',
    'assessment_create',
    'assessment_view',
    'assessment_submit',
  ];

  await Role.updateMany(
    { hierarchy: 'subordinate', isSystem: true },
    { $set: { permissionKeys: teacherPerms } }
  );
  await Role.updateMany(
    { hierarchy: 'user', isSystem: true },
    { $set: { permissionKeys: studentPerms } }
  );
  await Role.updateMany(
    { hierarchy: 'admin', isSystem: true },
    { $set: { permissionKeys: adminPerms } }
  );

  await User.updateMany({}, { $pull: { permissions: { $in: LEGACY_TASK_PERMS } } });
  await User.updateMany({ hierarchyRole: 'subordinate' }, { $pull: { permissions: 'user_create' } });

  await User.updateMany(
    { hierarchyRole: 'subordinate' },
    { $addToSet: { permissions: { $each: teacherPerms } } }
  );
  await User.updateMany(
    { hierarchyRole: 'user' },
    { $addToSet: { permissions: { $each: studentPerms } } }
  );
  await User.updateMany(
    { hierarchyRole: 'admin' },
    { $addToSet: { permissions: { $each: adminPerms } } }
  );

  catalogVersionBySubdomain.set(subdomain, CATALOG_VERSION);
}
