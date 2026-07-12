import { z } from 'zod';

export const createClassSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(1000).optional().default(''),
  academicYear: z.string().trim().max(32).optional().default(''),
  teacherIds: z.array(z.string().min(1)).optional().default([]),
  studentIds: z.array(z.string().min(1)).optional().default([]),
});

export const updateClassSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  academicYear: z.string().trim().max(32).optional(),
  isActive: z.boolean().optional(),
  teacherIds: z.array(z.string().min(1)).optional(),
  studentIds: z.array(z.string().min(1)).optional(),
});
