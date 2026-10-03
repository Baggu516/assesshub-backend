import mongoose from 'mongoose';

export const userSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    /** School registration ID: DOMAIN + 5 digits, uppercase (e.g. VISWAM48291) */
    registrationId: { type: String, uppercase: true, trim: true, default: null },
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
    passwordResetOtpHash: { type: String, select: false, default: null },
    passwordResetOtpExpiresAt: { type: Date, default: null },
    passwordResetOtpAttempts: { type: Number, default: 0 },
    lastLoginAt: { type: Date },
    /** Set once when the student trial starts. Admins and teachers leave these empty. */
    trialStartedAt: { type: Date, default: null },
    trialEndsAt: { type: Date, default: null },
    /** End of the last paid student period. Access continues while this is in the future. */
    subscriptionEndsAt: { type: Date, default: null },
    /** Last plan granted or purchased: monthly, quarterly, yearly. */
    subscriptionPlanId: { type: String, enum: ['monthly', 'quarterly', 'yearly'] },
    /** Master console can lock a student even when a trial or paid period is still open. */
    subscriptionSuspended: { type: Boolean, default: false },
  },
  { timestamps: true }
);

userSchema.index({ orgId: 1, email: 1 }, { unique: true });
userSchema.index(
  { orgId: 1, registrationId: 1 },
  { unique: true, partialFilterExpression: { registrationId: { $type: 'string' } } }
);
userSchema.index({ orgId: 1, parentUserId: 1 });
