import mongoose from 'mongoose';
import { PlatformUser } from '../../models/PlatformUser.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { hashPassword } from '../../utils/hash.js';
import { isPlatformPasswordLoginConfigured } from './platformAuth.util.js';

function serialize(u) {
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
  const err = new Error(
    'Cannot remove the last active platform user while env-based login is not configured. Set PLATFORM_ADMIN_EMAIL and password in .env, or create another platform user first.'
  );
  err.statusCode = 400;
  throw err;
}

export const listPlatformUsers = asyncHandler(async (_req, res) => {
  const rows = await PlatformUser.find().sort({ createdAt: -1 }).lean();
  res.json({ users: rows.map((r) => serialize(r)) });
});

export const getPlatformUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  const row = await PlatformUser.findById(id).lean();
  if (!row) return res.status(404).json({ error: 'User not found' });
  res.json({ user: serialize(row) });
});

export const createPlatformUser = asyncHandler(async (req, res) => {
  const email = String(req.body.email).trim().toLowerCase();
  const taken = await PlatformUser.findOne({ email });
  if (taken) {
    return res.status(409).json({ error: 'Email already registered' });
  }
  const passwordHash = await hashPassword(req.body.password);
  const doc = await PlatformUser.create({
    email,
    passwordHash,
    firstName: req.body.firstName?.trim() || '',
    lastName: req.body.lastName?.trim() || '',
    isActive: req.body.isActive !== false,
  });
  res.status(201).json({ user: serialize(doc.toObject()) });
});

export const patchPlatformUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  const user = await PlatformUser.findById(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (req.body.email !== undefined) {
    const email = String(req.body.email).trim().toLowerCase();
    const clash = await PlatformUser.findOne({ email, _id: { $ne: user._id } });
    if (clash) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    user.email = email;
  }
  if (req.body.password !== undefined) {
    user.passwordHash = await hashPassword(req.body.password);
  }
  if (req.body.firstName !== undefined) user.firstName = String(req.body.firstName).trim();
  if (req.body.lastName !== undefined) user.lastName = String(req.body.lastName).trim();
  if (req.body.isActive !== undefined) {
    if (req.body.isActive === false && user.isActive) {
      await assertCanRemoveLastActivePlatformUser(user);
    }
    user.isActive = req.body.isActive;
  }

  await user.save();
  res.json({ user: serialize(user.toObject()) });
});

export const deletePlatformUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  const user = await PlatformUser.findById(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  await assertCanRemoveLastActivePlatformUser(user);

  await PlatformUser.deleteOne({ _id: id });
  res.status(204).send();
});
