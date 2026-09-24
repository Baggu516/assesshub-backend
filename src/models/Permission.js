import mongoose from 'mongoose';

/** Permission catalog rows per tenant DB (keys used in User.permissions). */
export const permissionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    label: { type: String, required: true },
    description: { type: String, default: '' },
    /** Org feature this permission belongs to. Null means it is always available. */
    feature: { type: String, default: null },
    /** Hierarchy roles that may hold this permission: admin, subordinate, user. */
    roles: [{ type: String }],
  },
  { timestamps: true }
);
