import mongoose from 'mongoose';

export const CHUNKING_STRATEGIES = ['fixed', 'recursive', 'semantic', 'source'];
export const EMBEDDING_PROVIDERS = ['gemini', 'huggingface'];

export const knowledgeBaseConfigSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, unique: true },
    /** @deprecated Derived from chunking toggles; kept for backward compatibility. */
    chunkingStrategy: {
      type: String,
      enum: CHUNKING_STRATEGIES,
      default: 'recursive',
    },
    /** @deprecated Use targetTokens; kept for backward compatibility. */
    chunkSize: { type: Number, default: 500, min: 100, max: 2000 },
    /** @deprecated Use overlapTokens; kept for backward compatibility. */
    chunkOverlap: { type: Number, default: 50, min: 0, max: 400 },
    sourceOnlyMode: { type: Boolean, default: false },
    semanticSplitting: { type: Boolean, default: true },
    syntheticQuestions: { type: Boolean, default: true },
    autoSummary: { type: Boolean, default: true },
    multiHopSearch: { type: Boolean, default: true },
    targetTokens: { type: Number, default: 400, min: 100, max: 2000 },
    overlapTokens: { type: Number, default: 80, min: 0, max: 400 },
    embeddingProvider: {
      type: String,
      enum: EMBEDDING_PROVIDERS,
      default: 'gemini',
    },
    embeddingModel: { type: String, default: 'gemini-embedding-001', trim: true, maxlength: 120 },
  },
  { timestamps: true }
);
