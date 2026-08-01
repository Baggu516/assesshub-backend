import { z } from 'zod';

export const createAcademicYearSchema = z.object({
  label: z.string().trim().min(1).max(32),
  startDate: z.coerce.date().nullable().optional(),
  endDate: z.coerce.date().nullable().optional(),
  isCurrent: z.boolean().optional().default(false),
});

export const updateAcademicYearSchema = z.object({
  label: z.string().trim().min(1).max(32).optional(),
  startDate: z.coerce.date().nullable().optional(),
  endDate: z.coerce.date().nullable().optional(),
  isCurrent: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
