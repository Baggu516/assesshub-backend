import mongoose from 'mongoose';

/**
 * Optional org-scoped or template role definitions.
 * Authorization at runtime uses User.permissions (string keys), not role name checks.
 */
export const roleSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null },
    name: { type: String, required: true, trim: true },
    /** admin | subordinate | user — hierarchy only, not used for permission checks */
    hierarchy: {
      type: String,
      enum: ['admin', 'subordinate', 'user'],
      required: true,
    },
    permissionKeys: [{ type: String }],
    isSystem: { type: Boolean, default: false },
  },
  { timestamps: true }
);

roleSchema.index({ orgId: 1, name: 1 });
