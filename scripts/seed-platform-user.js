/**
 * Seed a platform admin user for /platform login.
 * Usage: npm run seed:platform
 * Optional env: SEED_PLATFORM_EMAIL, SEED_PLATFORM_PASSWORD,
 *               SEED_PLATFORM_FIRST_NAME, SEED_PLATFORM_LAST_NAME
 */
import dotenv from 'dotenv';
dotenv.config();

import { configureDns } from '../src/utils/dns.js';
configureDns();

import mongoose from 'mongoose';
import { PlatformUser } from '../src/models/PlatformUser.js';
import { hashPassword } from '../src/utils/hash.js';

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);

  const email = (process.env.SEED_PLATFORM_EMAIL || 'platform@assesshub.com').trim().toLowerCase();
  const password = process.env.SEED_PLATFORM_PASSWORD || 'Password123!';
  const firstName = process.env.SEED_PLATFORM_FIRST_NAME || 'Platform';
  const lastName = process.env.SEED_PLATFORM_LAST_NAME || 'Admin';

  let user = await PlatformUser.findOne({ email });
  if (!user) {
    user = await PlatformUser.create({
      email,
      passwordHash: await hashPassword(password),
      firstName,
      lastName,
      isActive: true,
    });
    console.log('Created platform user', email, password);
  } else {
    console.log('Platform user already exists', email);
  }

  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
