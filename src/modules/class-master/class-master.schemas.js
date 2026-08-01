import { z } from 'zod';

export const createClassMasterSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(1000).optional().default(''),
  nextClassMasterId: z.string().min(1).nullable().optional(),
  sortOrder: z.number().int().optional().default(0),
});

export const updateClassMasterSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  nextClassMasterId: z.string().min(1).nullable().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});
