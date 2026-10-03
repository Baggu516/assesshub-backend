import { z } from 'zod';

export const schoolBillingSchema = z
  .object({
    studentBillingEnabled: z.boolean().optional(),
    commissionPerStudentRupees: z.number().min(0).max(100000).optional(),
  })
  .refine(
    (data) => data.studentBillingEnabled !== undefined || data.commissionPerStudentRupees !== undefined,
    { message: 'Nothing to update' }
  );

export const assignPlanSchema = z.object({
  planId: z.enum(['monthly', 'quarterly', 'yearly']),
});

export const studentAccessSchema = z.object({
  suspended: z.boolean(),
});
