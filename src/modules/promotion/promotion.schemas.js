import { z } from 'zod';

export const previewPromotionSchema = z.object({
  fromAcademicYearId: z.string().min(1),
  toAcademicYearId: z.string().min(1),
});

const promotionRowSchema = z.object({
  studentId: z.string().min(1),
  enrollmentId: z.string().min(1),
  action: z.enum(['promote', 'retain', 'skip']),
  targetClassId: z.string().min(1).optional(),
  classMasterId: z.string().min(1).optional(),
  section: z.string().trim().max(32).optional().default(''),
});

export const executePromotionSchema = z.object({
  fromAcademicYearId: z.string().min(1),
  toAcademicYearId: z.string().min(1),
  promotions: z.array(promotionRowSchema).min(1),
});
