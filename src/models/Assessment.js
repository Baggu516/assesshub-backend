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
    section: { type: String, trim: true, default: 'Section A', maxlength: 80 },
    explanation: { type: String, trim: true, default: '', maxlength: 2000 },
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
    /** Exam duration in minutes. 0 = untimed (still CBT UI). */
    durationMinutes: { type: Number, min: 0, max: 300, default: 60 },
    /** Window when students may start the assessment */
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
    negativeMarkPerWrong: { type: Number, min: 0, max: 10, default: 0 },
    allowPartialCredit: { type: Boolean, default: true },
    showAnswersAfterSubmit: { type: Boolean, default: true },
    sections: [{ type: String, trim: true, maxlength: 80 }],
    /**
     * assessment — question paper students attempt, without the exam lock.
     * online_exam — CBT. Leaving fullscreen three times submits the exam.
     * Older documents have no kind and are treated as online exams.
     */
    kind: { type: String, enum: ['assessment', 'online_exam'], default: 'online_exam' },
    /** Online exams only. When true, the student must enable the camera before starting. */
    cameraMonitor: { type: Boolean, default: false },
    status: { type: String, enum: ASSESSMENT_STATUSES, default: 'draft' },
    /** Students see scores only after teacher announces results */
    resultsReleased: { type: Boolean, default: false },
    resultsReleasedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    questions: [questionSchema],
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

assessmentSchema.index({ orgId: 1, createdBy: 1, status: 1 });
