import mongoose from 'mongoose';

export const studentPaymentSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    provider: { type: String, enum: ['razorpay', 'dev', 'master'], required: true },
    status: { type: String, enum: ['created', 'paid', 'failed'], default: 'created' },
    planId: { type: String, enum: ['monthly', 'quarterly', 'yearly'], required: true },
    periodDays: { type: Number, required: true },
    amountPaise: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    orderId: { type: String, default: '' },
    providerPaymentId: { type: String, default: '' },
    periodStartsAt: { type: Date },
    periodEndsAt: { type: Date },
    paidAt: { type: Date },
  },
  { timestamps: true }
);

studentPaymentSchema.index(
  { orderId: 1 },
  { unique: true, partialFilterExpression: { orderId: { $gt: '' } } }
);
