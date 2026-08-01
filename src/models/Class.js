import mongoose from 'mongoose';

/**
 * AcademicClass — a ClassMaster + section in a specific AcademicYear.
 * Collection name stays "Class" for compatibility.
 * Example: Grade 5 / Section A / 2026-27
 */
export const classSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    /** Denormalized display name, e.g. "Grade 5 A" */
    name: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: '', maxlength: 1000 },
    /** Denormalized year label for list sorting / legacy clients */
    academicYear: { type: String, default: '', trim: true, maxlength: 32 },
    academicYearId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AcademicYear',
      default: null,
      index: true,
    },
    classMasterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ClassMaster',
      default: null,
      index: true,
    },
    /** Section letter/name, e.g. "A", "B" */
    section: { type: String, default: '', trim: true, maxlength: 32 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    isActive: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

classSchema.index({ orgId: 1, name: 1, academicYear: 1 });
classSchema.index(
  { orgId: 1, academicYearId: 1, classMasterId: 1, section: 1 },
  {
    unique: true,
    partialFilterExpression: {
      deletedAt: null,
      academicYearId: { $type: 'objectId' },
      classMasterId: { $type: 'objectId' },
    },
  }
);
