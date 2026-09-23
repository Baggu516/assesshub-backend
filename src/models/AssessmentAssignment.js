import mongoose from 'mongoose';

export const ASSIGNMENT_STATUSES = ['pending', 'submitted'];

const answerSchema = new mongoose.Schema(
  {
    questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
    selectedOptionIds: [{ type: mongoose.Schema.Types.ObjectId }],
    textAnswer: { type: String, default: '', maxlength: 200 },
    isCorrect: { type: Boolean, default: false },
    pointsEarned: { type: Number, default: 0 },
  },
  { _id: false }
);

export const assessmentAssignmentSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    assessmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Assessment', required: true, index: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    /** Academic year this assignment belongs to (promotions / history stay separate) */
    academicYearId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AcademicYear',
      default: null,
      index: true,
    },
    dueDate: { type: Date, default: null },
    /** Groups used when assigning (for reopen / edit UX). Empty if assigned by studentIds only. */
    sourceGroupIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'StudentGroup' }],
    status: { type: String, enum: ASSIGNMENT_STATUSES, default: 'pending' },
    /** When the student first opened the CBT attempt */
    startedAt: { type: Date, default: null },
    /** Timer end (startedAt + assessment.durationMinutes) */
    expiresAt: { type: Date, default: null },
    submitReason: {
      type: String,
      enum: ['manual', 'timer', 'fullscreen_exits'],
      default: undefined,
    },
    /** How many times the student left fullscreen during an online exam. */
    fullscreenExitCount: { type: Number, min: 0, default: 0 },
    submittedAt: { type: Date, default: null },
    /** Teacher hid this attempt's score from the student. The attempt itself stays. */
    resultsHidden: { type: Boolean, default: false },
    score: { type: Number, default: 0 },
    maxScore: { type: Number, min: 0, default: 0 },
    answers: [answerSchema],
  },
  { timestamps: true }
);

assessmentAssignmentSchema.index({ orgId: 1, studentId: 1, status: 1 });
assessmentAssignmentSchema.index({ orgId: 1, studentId: 1, academicYearId: 1 });
assessmentAssignmentSchema.index({ orgId: 1, assignedBy: 1, academicYearId: 1 });
/** Same quiz can be reassigned in a different year */
assessmentAssignmentSchema.index(
  { orgId: 1, assessmentId: 1, studentId: 1, academicYearId: 1 },
  { unique: true }
);
