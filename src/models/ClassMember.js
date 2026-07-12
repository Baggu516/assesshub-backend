import mongoose from 'mongoose';

export const classMemberSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: ['teacher', 'student'], required: true },
    /** Soft end when teacher/student leaves the class — history preserved */
    isActive: { type: Boolean, default: true },
    endedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

classMemberSchema.index({ orgId: 1, classId: 1, role: 1, isActive: 1 });
classMemberSchema.index(
  { classId: 1, userId: 1, role: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);
