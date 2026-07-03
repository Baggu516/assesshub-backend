import { z } from 'zod';
import { ALL_PERMISSION_KEYS } from '../../constants/permissions.js';

const permissionArray = z
  .array(z.string())
  .refine((arr) => arr.every((k) => ALL_PERMISSION_KEYS.includes(k)), 'Invalid permission key');

export const createSubordinateSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  firstName: z.string().max(80).optional(),
  lastName: z.string().max(80).optional(),
  permissions: permissionArray.optional(),
});

export const createMemberSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128).optional(),
  firstName: z.string().max(80).optional(),
  lastName: z.string().max(80).optional(),
  parentUserId: z.string().optional(),
  permissions: permissionArray.optional(),
});

export const updateUserSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(8).max(128).optional(),
  firstName: z.string().max(80).optional(),
  lastName: z.string().max(80).optional(),
  permissions: permissionArray.optional(),
  isActive: z.boolean().optional(),
  parentUserId: z.string().nullable().optional(),
});

export const inviteUserSchema = z.object({
  email: z.string().email(),
  firstName: z.string().max(80).optional(),
  lastName: z.string().max(80).optional(),
  parentUserId: z.string().optional(),
  permissions: permissionArray.optional(),
});
