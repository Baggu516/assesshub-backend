import mongoose from 'mongoose';

export const proctorCaptureSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    assignmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AssessmentAssignment',
      required: true,
      index: true,
    },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    storagePath: { type: String, required: true },
    capturedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

proctorCaptureSchema.index({ orgId: 1, assignmentId: 1, capturedAt: -1 });
