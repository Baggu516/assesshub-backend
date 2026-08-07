import mongoose from 'mongoose';

/** Stored strategies: original | semantic (preferred) plus legacy internal names. */
export const CHUNKING_STRATEGIES = [
  'original',
  'semantic',
  'fixed',
  'recursive',
  'source',
];
/** Active provider. Legacy DB values (gemini/huggingface) are healed to ollama on use. */
export const EMBEDDING_PROVIDERS = ['ollama'];
export const LEGACY_EMBEDDING_PROVIDERS = ['ollama', 'gemini', 'huggingface'];

export const knowledgeBaseConfigSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, unique: true },
    /** Preferred: 'original' | 'semantic'. Legacy values (source/recursive/fixed) still accepted. */
    chunkingStrategy: {
      type: String,
      enum: CHUNKING_STRATEGIES,
      default: 'semantic',
    },
    /** Token budget per chunk (also mirrored to targetTokens). */
    chunkSize: { type: Number, default: 400, min: 100, max: 2000 },
    /** Token overlap between consecutive chunks (also mirrored to overlapTokens). */
    chunkOverlap: { type: Number, default: 80, min: 0, max: 400 },
    /** @deprecated Derived from chunkingStrategy === 'original'. */
    sourceOnlyMode: { type: Boolean, default: false },
    /** @deprecated Derived from chunkingStrategy === 'semantic'. */
    semanticSplitting: { type: Boolean, default: true },
    syntheticQuestions: { type: Boolean, default: true },
    autoSummary: { type: Boolean, default: true },
    multiHopSearch: { type: Boolean, default: true },
    /** @deprecated Alias of chunkSize (tokens). */
    targetTokens: { type: Number, default: 400, min: 100, max: 2000 },
    /** @deprecated Alias of chunkOverlap (tokens). */
    overlapTokens: { type: Number, default: 80, min: 0, max: 400 },
    embeddingProvider: {
      type: String,
      enum: LEGACY_EMBEDDING_PROVIDERS,
      default: 'ollama',
    },
    embeddingModel: { type: String, default: 'nomic-embed-text', trim: true, maxlength: 120 },
  },
  { timestamps: true }
);
