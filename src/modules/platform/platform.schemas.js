import { z } from 'zod';

export const loginPlatformSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const createOrganizationSchema = z
  .object({
    name: z.string().min(1).max(200),
    subdomain: z
      .string()
      .min(2)
      .max(63)
      .regex(/^[a-z0-9-]+$/, 'Use lowercase letters, digits, and hyphens only'),
    isActive: z.boolean().optional(),
    plan: z.enum(['assessments_only', 'ai_dashboard']).optional(),
    adminEmail: z.string().email().optional(),
    adminPassword: z.string().min(8).optional(),
    firstName: z.string().max(100).optional(),
    lastName: z.string().max(100).optional(),
  })
  .superRefine((data, ctx) => {
    const hasEmail = !!data.adminEmail;
    const hasPw = !!data.adminPassword;
    if (hasEmail !== hasPw) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide both admin email and password, or leave both empty',
        path: hasEmail ? ['adminPassword'] : ['adminEmail'],
      });
    }
  });

export const patchOrganizationSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    isActive: z.boolean().optional(),
    plan: z.enum(['assessments_only', 'ai_dashboard']).optional(),
  })
  .refine(
    (data) => data.name !== undefined || data.isActive !== undefined || data.plan !== undefined,
    {
      message: 'Provide at least one of name, isActive, plan',
    }
  );

export const createPlatformUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  isActive: z.boolean().optional(),
});

export const patchPlatformUserSchema = z
  .object({
    email: z.string().email().optional(),
    password: z.string().min(8).max(200).optional(),
    firstName: z.string().max(100).optional(),
    lastName: z.string().max(100).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });
