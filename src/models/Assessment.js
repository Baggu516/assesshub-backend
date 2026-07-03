import mongoose from 'mongoose';

export const ASSESSMENT_STATUSES = ['draft', 'published', 'closed'];
export const QUESTION_TYPES = ['single_select', 'multi_select', 'short_answer'];

const questionOptionSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true, maxlength: 500 },
    isCorrect: { type: Boolean, default: false },
  },
  { _id: true }
);

const questionSchema = new mongoose.Schema(
  {
    type: { type: String, enum: QUESTION_TYPES, required: true },
    prompt: { type: String, required: true, trim: true, maxlength: 2000 },
    points: { type: Number, min: 0, default: 1 },
    order: { type: Number, default: 0 },
    options: [questionOptionSchema],
    acceptedAnswers: [{ type: String, trim: true, maxlength: 100 }],
    caseSensitive: { type: Boolean, default: false },
  },
  { _id: true }
);

export const assessmentSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 500 },
    description: { type: String, default: '', maxlength: 5000 },
    status: { type: String, enum: ASSESSMENT_STATUSES, default: 'draft' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    questions: [questionSchema],
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

assessmentSchema.index({ orgId: 1, createdBy: 1, status: 1 });
