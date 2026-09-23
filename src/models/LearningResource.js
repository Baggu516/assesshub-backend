import mongoose from 'mongoose';

export const LEARNING_RESOURCE_KINDS = ['worksheet', 'assignment'];

export const learningResourceSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    kind: { type: String, enum: LEARNING_RESOURCE_KINDS, required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: '', maxlength: 5000 },
    classIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Class' }],
    fileStoragePath: { type: String, default: '' },
    fileName: { type: String, default: '', maxlength: 260 },
    fileMimeType: { type: String, default: '' },
    fileSize: { type: Number, default: 0 },
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
    dueAt: { type: Date, default: null },
    isPublished: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

learningResourceSchema.index({ orgId: 1, kind: 1, isPublished: 1, createdAt: -1 });
