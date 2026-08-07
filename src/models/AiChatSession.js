import mongoose from 'mongoose';

const knowledgeSourceSchema = new mongoose.Schema(
  {
    documentId: { type: String, required: true },
    title: { type: String, default: '' },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true, maxlength: 12000 },
    /** Set on user messages: whether RAG snippets were injected for this turn. */
    knowledgeBaseUsed: { type: Boolean, default: undefined },
    knowledgeSources: { type: [knowledgeSourceSchema], default: undefined },
    askedAt: { type: Date, default: undefined },
    /** Set on assistant messages from thumbs up/down. */
    feedback: { type: String, enum: ['up', 'down'], default: undefined },
    feedbackAt: { type: Date, default: undefined },
  },
  { _id: false }
);

export const aiChatSessionSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, default: 'New chat', trim: true, maxlength: 200 },
    messages: { type: [messageSchema], default: [] },
    /** Reused on follow-ups to avoid RAG on every message in the same thread. */
    cachedKnowledgeQuery: { type: String, default: '', maxlength: 2000 },
    cachedKnowledgeContext: { type: String, default: '', maxlength: 50000 },
    cachedKnowledgeSources: { type: [knowledgeSourceSchema], default: [] },
  },
  { timestamps: true }
);

aiChatSessionSchema.index({ orgId: 1, userId: 1, updatedAt: -1 });
