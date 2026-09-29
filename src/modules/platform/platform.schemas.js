import { z } from 'zod';
import { isReservedSubdomain } from '../../utils/reservedSubdomains.js';

export const loginPlatformSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const orgFeaturesSchema = z.object({
  aiDashboard: z.boolean(),
  aiAssessmentCreate: z.boolean(),
  worksheets: z.boolean().optional().default(false),
  assessments: z.boolean().optional().default(false),
  onlineExams: z.boolean().optional().default(false),
});

const subdomainSchema = z
  .string()
  .min(2)
  .max(63)
  .regex(/^[a-z0-9-]+$/, 'Use lowercase letters, digits, and hyphens only')
  .refine((s) => !isReservedSubdomain(s), {
    message: 'This subdomain is reserved',
  });

/** School register ID string — becomes PREFIX in student/teacher IDs (PREFIX + 5 digits). */
const registrationPrefixSchema = z
  .string()
  .trim()
  .min(2)
  .max(24)
  .transform((s) => s.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())
  .refine((s) => /^[A-Z0-9]{2,24}$/.test(s), {
    message: 'Register ID string: 2–24 letters or digits only',
  });

export const createOrganizationSchema = z
  .object({
    name: z.string().min(1).max(200),
    subdomain: subdomainSchema,
    registrationPrefix: registrationPrefixSchema,
    isActive: z.boolean().optional(),
    tagline: z.string().trim().max(160).optional(),
    /** @deprecated Prefer `features`. Still accepted for older clients. */
    plan: z.enum(['assessments_only', 'ai_dashboard']).optional(),
    features: orgFeaturesSchema.optional(),
    adminEmail: z.string().email().optional(),
    adminPassword: z.string().min(8).optional(),
    firstName: z.string().max(100).optional(),
    lastName: z.string().max(100).optional(),
    logoUrl: z.string().url().max(2000).optional(),
    logoStoragePath: z.string().min(1).max(500).optional(),
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
    const hasLogoUrl = !!data.logoUrl;
    const hasLogoPath = !!data.logoStoragePath;
    if (hasLogoUrl !== hasLogoPath) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Logo URL and storage path must be sent together',
        path: ['logoUrl'],
      });
    }
  });

export const patchOrganizationSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    isActive: z.boolean().optional(),
    tagline: z.string().trim().max(160).nullable().optional(),
    /** Set once if missing on legacy orgs; ignored when already set (locked). */
    registrationPrefix: registrationPrefixSchema.optional(),
    clearLogo: z.boolean().optional(),
    /** @deprecated Prefer `features`. Still accepted for older clients. */
    plan: z.enum(['assessments_only', 'ai_dashboard']).optional(),
    features: orgFeaturesSchema.optional(),
    logoUrl: z.string().url().max(2000).optional(),
    logoStoragePath: z.string().min(1).max(500).optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.isActive !== undefined ||
      data.plan !== undefined ||
      data.features !== undefined ||
      data.tagline !== undefined ||
      data.registrationPrefix !== undefined ||
      data.clearLogo !== undefined ||
      data.logoUrl !== undefined,
    {
      message:
        'Provide at least one of name, isActive, plan, features, tagline, registrationPrefix, clearLogo, logoUrl',
    }
  )
  .refine((data) => !!data.logoUrl === !!data.logoStoragePath, {
    message: 'Logo URL and storage path must be sent together',
    path: ['logoUrl'],
  });

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
