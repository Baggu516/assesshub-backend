import mongoose from 'mongoose';

export const KB_DOC_STATUSES = ['pending', 'processing', 'ready', 'failed'];

export const knowledgeDocumentSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    originalName: { type: String, required: true, trim: true, maxlength: 255 },
    mimeType: { type: String, default: '' },
    fileType: { type: String, enum: ['pdf', 'docx', 'html', 'txt'], required: true },
    storagePath: { type: String, required: true },
    fileSize: { type: Number, default: 0 },
    status: { type: String, enum: KB_DOC_STATUSES, default: 'pending' },
    errorMessage: { type: String, default: '' },
    extractedCharCount: { type: Number, default: 0 },
    chunkCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

knowledgeDocumentSchema.index({ orgId: 1, createdAt: -1 });
