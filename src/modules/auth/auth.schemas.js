import { z } from 'zod';

export const registerOrgSchema = z.object({
  organizationName: z.string().min(2).max(120),
  subdomain: z
    .string()
    .min(2)
    .max(63)
    .regex(/^[a-z0-9-]+$/),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8).max(128),
  firstName: z.string().max(80).optional(),
  lastName: z.string().max(80).optional(),
});

export const loginSchema = z.object({
  /** Email or registration ID (DOMAIN + 5 digits) */
  email: z.string().min(1).max(254).optional(),
  identifier: z.string().min(1).max(254).optional(),
  password: z.string().min(1),
}).refine((d) => Boolean(d.email || d.identifier), {
  message: 'Email or registration ID is required',
  path: ['email'],
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(8).max(128),
});

export const forgotPasswordSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
});

export const resetPasswordSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  otp: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
  password: z.string().min(8).max(128),
});
