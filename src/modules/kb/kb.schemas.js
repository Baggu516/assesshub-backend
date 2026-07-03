import { z } from 'zod';
import { CHUNKING_STRATEGIES, EMBEDDING_PROVIDERS } from '../../models/KnowledgeBaseConfig.js';

export const kbConfigPatchSchema = z.object({
  chunkingStrategy: z.enum(CHUNKING_STRATEGIES).optional(),
  chunkSize: z.coerce.number().min(100).max(2000).optional(),
  chunkOverlap: z.coerce.number().min(0).max(400).optional(),
  sourceOnlyMode: z.boolean().optional(),
  semanticSplitting: z.boolean().optional(),
  syntheticQuestions: z.boolean().optional(),
  autoSummary: z.boolean().optional(),
  multiHopSearch: z.boolean().optional(),
  targetTokens: z.coerce.number().min(100).max(2000).optional(),
  overlapTokens: z.coerce.number().min(0).max(400).optional(),
  embeddingProvider: z.enum(EMBEDDING_PROVIDERS).optional(),
  embeddingModel: z.string().trim().min(1).max(120).optional(),
});
