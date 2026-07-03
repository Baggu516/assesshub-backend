import mongoose from 'mongoose';

export const studentGroupSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: '', maxlength: 1000 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    studentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

studentGroupSchema.index({ orgId: 1, createdBy: 1 });
