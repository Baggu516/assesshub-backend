import { z } from 'zod';

export const createClassSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(1000).optional().default(''),
  academicYearId: z.string().min(1),
  classMasterId: z.string().min(1),
  section: z.string().trim().max(32).optional().default(''),
  /** @deprecated Prefer academicYearId; kept for transitional clients */
  academicYear: z.string().trim().max(32).optional(),
  teacherIds: z.array(z.string().min(1)).optional().default([]),
  studentIds: z.array(z.string().min(1)).optional().default([]),
});

export const updateClassSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  academicYearId: z.string().min(1).optional(),
  classMasterId: z.string().min(1).optional(),
  section: z.string().trim().max(32).optional(),
  academicYear: z.string().trim().max(32).optional(),
  isActive: z.boolean().optional(),
  teacherIds: z.array(z.string().min(1)).optional(),
  studentIds: z.array(z.string().min(1)).optional(),
});
