import mongoose from 'mongoose';

export const CHUNK_KINDS = ['content', 'summary', 'synthetic_question'];

export const knowledgeChunkSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'KnowledgeDocument',
      required: true,
      index: true,
    },
    chunkIndex: { type: Number, required: true },
    chunkKind: { type: String, enum: CHUNK_KINDS, default: 'content' },
    text: { type: String, required: true, maxlength: 50000 },
    /** Embedding vector for similarity search. */
    embedding: { type: [Number], default: [] },
  },
  { timestamps: true }
);

knowledgeChunkSchema.index({ orgId: 1, documentId: 1, chunkIndex: 1 }, { unique: true });
