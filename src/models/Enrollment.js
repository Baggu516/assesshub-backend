import mongoose from 'mongoose';

/**
 * Student ↔ AcademicClass for a specific AcademicYear.
 * Never overwrite history — end the old enrollment and create a new one on promote/move.
 */
export const enrollmentSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    academicClassId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true, index: true },
    academicYearId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AcademicYear',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['active', 'promoted', 'retained', 'transferred', 'ended'],
      default: 'active',
    },
    isActive: { type: Boolean, default: true },
    enrolledAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
    /** Prior enrollment this one was created from (promotion / retention) */
    previousEnrollmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Enrollment',
      default: null,
    },
  },
  { timestamps: true }
);

enrollmentSchema.index({ orgId: 1, academicYearId: 1, studentId: 1 });
enrollmentSchema.index({ orgId: 1, academicClassId: 1, isActive: 1 });
enrollmentSchema.index(
  { academicYearId: 1, studentId: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);
