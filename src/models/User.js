import mongoose from 'mongoose';

export const userSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, select: false },
    firstName: { type: String, trim: true, default: '' },
    lastName: { type: String, trim: true, default: '' },
    /** Hierarchy label for org tree — authorization uses `permissions` */
    hierarchyRole: {
      type: String,
      enum: ['admin', 'subordinate', 'user'],
      required: true,
    },
    parentUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    roleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Role', default: null },
    /** Effective permission keys for this user (dynamic RBAC). */
    permissions: [{ type: String }],
    isActive: { type: Boolean, default: true },
    inviteToken: { type: String, select: false },
    inviteExpiresAt: { type: Date },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

userSchema.index({ orgId: 1, email: 1 }, { unique: true });
userSchema.index({ orgId: 1, parentUserId: 1 });
