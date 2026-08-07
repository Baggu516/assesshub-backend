import { z } from 'zod';
import { EMBEDDING_PROVIDERS } from '../../models/KnowledgeBaseConfig.js';
import { CHUNKING_STRATEGY_OPTIONS } from './kb.config.util.js';

export const kbConfigPatchSchema = z
  .object({
    chunkingStrategy: z.enum(CHUNKING_STRATEGY_OPTIONS).optional(),
    chunkSize: z.coerce.number().min(100).max(2000).optional(),
    chunkOverlap: z.coerce.number().min(0).max(400).optional(),
    // Legacy aliases
    sourceOnlyMode: z.boolean().optional(),
    semanticSplitting: z.boolean().optional(),
    targetTokens: z.coerce.number().min(100).max(2000).optional(),
    overlapTokens: z.coerce.number().min(0).max(400).optional(),
    syntheticQuestions: z.boolean().optional(),
    autoSummary: z.boolean().optional(),
    multiHopSearch: z.boolean().optional(),
    embeddingProvider: z.enum(EMBEDDING_PROVIDERS).optional(),
    embeddingModel: z.string().trim().min(1).max(120).optional(),
  })
  .superRefine((data, ctx) => {
    const size = data.chunkSize ?? data.targetTokens;
    const overlap = data.chunkOverlap ?? data.overlapTokens;
    if (size != null && overlap != null && !(size > overlap)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'chunkSize must be greater than chunkOverlap',
        path: ['chunkOverlap'],
      });
    }
    // Mutually exclusive legacy toggles: if both sent conflicting, prefer chunkingStrategy
    if (
      data.chunkingStrategy == null &&
      data.sourceOnlyMode === true &&
      data.semanticSplitting === true
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Original and Semantic chunking are mutually exclusive',
        path: ['chunkingStrategy'],
      });
    }
  });
