import mongoose from 'mongoose';

export const classMasterSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    /** Stable grade/level name, e.g. "Grade 5" — reused every year */
    name: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: '', maxlength: 1000 },
    /** Suggested next ClassMaster when promoting (optional) */
    nextClassMasterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ClassMaster',
      default: null,
    },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

classMasterSchema.index(
  { orgId: 1, name: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);
