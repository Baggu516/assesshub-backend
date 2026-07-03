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
  email: z.string().email(),
  password: z.string().min(1),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(8).max(128),
});
