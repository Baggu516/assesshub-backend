const initializedSubdomains = new Set();

const LEGACY_TASK_PERMS = ['task_create', 'task_view', 'task_update', 'task_delete'];

/**
 * Idempotent: seeds Permission docs and legacy cleanup once per tenant process.
 */
export async function ensureTenantCatalog(models, subdomain) {
  if (initializedSubdomains.has(subdomain)) return;

  const seeds = [
    { key: 'user_create', label: 'Create students', description: 'Invite or create students' },
    { key: 'subordinate_create', label: 'Create teachers', description: 'Add teachers under admin' },
    { key: 'settings_manage', label: 'Manage settings', description: 'Organization settings' },
    { key: 'assessment_create', label: 'Create assessments', description: 'Build and assign assessments' },
    { key: 'assessment_view', label: 'View assessments', description: 'View assigned or created assessments' },
    { key: 'assessment_submit', label: 'Submit assessments', description: 'Take and submit assessments' },
  ];

  const { Permission, Role, User } = models;

  for (const s of seeds) {
    await Permission.updateOne({ key: s.key }, { $set: s }, { upsert: true });
  }

  await Permission.deleteMany({ key: { $in: LEGACY_TASK_PERMS } });

  const teacherPerms = ['user_create', 'assessment_create', 'assessment_view'];
  const studentPerms = ['assessment_view', 'assessment_submit'];
  const adminPerms = [
    'subordinate_create',
    'user_create',
    'settings_manage',
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

  initializedSubdomains.add(subdomain);
}
