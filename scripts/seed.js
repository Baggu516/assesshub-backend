/**
 * Seed a demo organization + admin for local development.
 * Usage: npm run seed
 * Optional env: SEED_SUBDOMAIN, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD
 */
import dotenv from 'dotenv';
dotenv.config();

import { configureDns } from '../src/utils/dns.js';
configureDns();

import mongoose from 'mongoose';
import { Organization } from '../src/models/Organization.js';
import { getTenantModels } from '../src/db/tenantModels.js';
import { ensureTenantCatalog } from '../src/db/tenantCatalog.js';
import { hashPassword } from '../src/utils/hash.js';
import { ALL_PERMISSION_KEYS } from '../src/constants/permissions.js';

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);

  const subdomain = process.env.SEED_SUBDOMAIN || 'demo';
  let org = await Organization.findOne({ subdomain });
  if (!org) {
    org = await Organization.create({ name: 'Demo Org', subdomain });
    console.log('Created org', subdomain);
  }

  const models = getTenantModels(subdomain);
  await ensureTenantCatalog(models, subdomain);

  const { Role, User } = models;

  await Role.findOneAndUpdate(
    { orgId: org._id, hierarchy: 'admin' },
    {
      $setOnInsert: {
        orgId: org._id,
        name: 'Administrator',
        hierarchy: 'admin',
        permissionKeys: ALL_PERMISSION_KEYS,
        isSystem: true,
      },
    },
    { upsert: true }
  );

  const email = process.env.SEED_ADMIN_EMAIL || 'admin@demo.com';
  const password = process.env.SEED_ADMIN_PASSWORD || 'Password123!';
  let user = await User.findOne({ orgId: org._id, email });
  const adminRole = await Role.findOne({ orgId: org._id, hierarchy: 'admin' });

  if (!user) {
    user = await User.create({
      orgId: org._id,
      email,
      passwordHash: await hashPassword(password),
      firstName: 'Demo',
      lastName: 'Admin',
      hierarchyRole: 'admin',
      parentUserId: null,
      roleId: adminRole?._id,
      permissions: ALL_PERMISSION_KEYS,
    });
    console.log('Created admin', email, password);
  } else {
    console.log('Admin already exists', email);
  }

  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
