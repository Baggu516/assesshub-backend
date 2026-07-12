import mongoose from 'mongoose';

export const classSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: '', maxlength: 1000 },
    /** Free-form year/term label, e.g. "2025-26" */
    academicYear: { type: String, default: '', trim: true, maxlength: 32 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    isActive: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

classSchema.index({ orgId: 1, name: 1, academicYear: 1 });
