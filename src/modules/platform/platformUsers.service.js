import mongoose from 'mongoose';
import { PlatformUser } from '../../models/PlatformUser.js';
import { AppError } from '../../utils/errors.js';
import { hashPassword } from '../../utils/hash.js';
import { isPlatformPasswordLoginConfigured } from './platformAuth.util.js';

export function serializePlatformUser(u) {
  return {
    id: u._id.toString(),
    email: u.email,
    firstName: u.firstName || '',
    lastName: u.lastName || '',
    isActive: u.isActive,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

async function assertCanRemoveLastActivePlatformUser(userDoc) {
  if (isPlatformPasswordLoginConfigured()) return;
  if (!userDoc.isActive) return;
  const remainingActive = await PlatformUser.countDocuments({
    _id: { $ne: userDoc._id },
    isActive: true,
  });
  if (remainingActive >= 1) return;
  throw new AppError(
    'Cannot remove the last active platform user while env-based login is not configured. Set PLATFORM_ADMIN_EMAIL and password in .env, or create another platform user first.',
    400
  );
}

export async function listPlatformUsers() {
  const rows = await PlatformUser.find().sort({ createdAt: -1 }).lean();
  return rows.map((r) => serializePlatformUser(r));
}

export async function getPlatformUserById(id) {
  if (!mongoose.isValidObjectId(id)) throw new AppError('Invalid user id', 400);
  const row = await PlatformUser.findById(id).lean();
  if (!row) throw new AppError('User not found', 404);
  return serializePlatformUser(row);
}

export async function createPlatformUser(body) {
  const email = String(body.email).trim().toLowerCase();
  const taken = await PlatformUser.findOne({ email });
  if (taken) throw new AppError('Email already registered', 409);

  const passwordHash = await hashPassword(body.password);
  const doc = await PlatformUser.create({
    email,
    passwordHash,
    firstName: body.firstName?.trim() || '',
    lastName: body.lastName?.trim() || '',
    isActive: body.isActive !== false,
  });
  return serializePlatformUser(doc.toObject());
}

export async function patchPlatformUserById(id, body) {
  if (!mongoose.isValidObjectId(id)) throw new AppError('Invalid user id', 400);
  const user = await PlatformUser.findById(id);
  if (!user) throw new AppError('User not found', 404);

  if (body.email !== undefined) {
    const email = String(body.email).trim().toLowerCase();
    const clash = await PlatformUser.findOne({ email, _id: { $ne: user._id } });
    if (clash) throw new AppError('Email already registered', 409);
    user.email = email;
  }
  if (body.password !== undefined) {
    user.passwordHash = await hashPassword(body.password);
  }
  if (body.firstName !== undefined) user.firstName = String(body.firstName).trim();
  if (body.lastName !== undefined) user.lastName = String(body.lastName).trim();
  if (body.isActive !== undefined) {
    if (body.isActive === false && user.isActive) {
      await assertCanRemoveLastActivePlatformUser(user);
    }
    user.isActive = body.isActive;
  }

  await user.save();
  return serializePlatformUser(user.toObject());
}

export async function deletePlatformUserById(id) {
  if (!mongoose.isValidObjectId(id)) throw new AppError('Invalid user id', 400);
  const user = await PlatformUser.findById(id);
  if (!user) throw new AppError('User not found', 404);

  await assertCanRemoveLastActivePlatformUser(user);
  await PlatformUser.deleteOne({ _id: id });
}
