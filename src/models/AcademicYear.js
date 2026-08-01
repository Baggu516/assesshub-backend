import mongoose from 'mongoose';

export const academicYearSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    /** Display label, e.g. "2025-26" */
    label: { type: String, required: true, trim: true, maxlength: 32 },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    /** At most one current year per org (enforced in service) */
    isCurrent: { type: Boolean, default: false, index: true },
    isActive: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

academicYearSchema.index(
  { orgId: 1, label: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);
