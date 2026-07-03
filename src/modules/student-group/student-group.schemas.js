import { z } from 'zod';

export const createStudentGroupSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(1000).optional().default(''),
  studentIds: z.array(z.string().min(1)).optional().default([]),
});

export const updateStudentGroupSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  studentIds: z.array(z.string().min(1)).optional(),
});
