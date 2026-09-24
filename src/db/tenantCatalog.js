import { keysForRole, loadMasterPermissionCatalog } from './permissionCatalog.js';

const catalogVersionBySubdomain = new Map();
/** Bump when permission seeds / default role perms change so tenants re-sync in-process. */
const CATALOG_VERSION = 5;

const LEGACY_TASK_PERMS = ['task_create', 'task_view', 'task_update', 'task_delete'];

/**
 * Copy the registry permission catalog into this tenant, then align default role grants.
 */
export async function ensureTenantCatalog(models, subdomain) {
  if (catalogVersionBySubdomain.get(subdomain) === CATALOG_VERSION) return;

  const seeds = await loadMasterPermissionCatalog();

  const { Permission, Role, User } = models;

  for (const s of seeds) {
    await Permission.updateOne({ key: s.key }, { $set: s }, { upsert: true });
  }

  const catalogKeys = seeds.map((row) => row.key);
  await Permission.deleteMany({ key: { $nin: [...catalogKeys, ...LEGACY_TASK_PERMS] } });
  await Permission.deleteMany({ key: { $in: LEGACY_TASK_PERMS } });

  const teacherPerms = keysForRole('subordinate');
  const studentPerms = keysForRole('user');
  const adminPerms = keysForRole('admin');
  const notForTeachers = catalogKeys.filter((key) => !teacherPerms.includes(key));
  const notForStudents = catalogKeys.filter((key) => !studentPerms.includes(key));

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
    { $pull: { permissions: { $in: notForTeachers } } }
  );
  await User.updateMany(
    { hierarchyRole: 'user' },
    { $pull: { permissions: { $in: notForStudents } } }
  );

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
