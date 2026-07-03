import mongoose from 'mongoose';

export const refreshTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    tokenHash: { type: String, required: true, unique: true },
    userAgent: { type: String },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
