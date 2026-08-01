import { z } from 'zod';

const questionOptionSchema = z.object({
  text: z.string().trim().min(1).max(500),
  isCorrect: z.boolean().default(false),
});

const questionSchema = z
  .object({
    type: z.enum(['single_select', 'multi_select', 'short_answer']),
    prompt: z.string().trim().min(1).max(2000),
    points: z.number().min(0).max(100).default(1),
    order: z.number().int().min(0).default(0),
    options: z.array(questionOptionSchema).optional().default([]),
    acceptedAnswers: z.array(z.string().trim().min(1).max(100)).optional().default([]),
    caseSensitive: z.boolean().optional().default(false),
  })
  .superRefine((q, ctx) => {
    if (q.type === 'single_select') {
      if (q.options.length < 2) {
        ctx.addIssue({ code: 'custom', message: 'Single select needs at least 2 options' });
      }
      const correct = q.options.filter((o) => o.isCorrect);
      if (correct.length !== 1) {
        ctx.addIssue({ code: 'custom', message: 'Single select must have exactly one correct option' });
      }
    }
    if (q.type === 'multi_select') {
      if (q.options.length < 2) {
        ctx.addIssue({ code: 'custom', message: 'Multi select needs at least 2 options' });
      }
      const correct = q.options.filter((o) => o.isCorrect);
      if (correct.length < 1) {
        ctx.addIssue({ code: 'custom', message: 'Multi select must have at least one correct option' });
      }
    }
    if (q.type === 'short_answer') {
      if (!q.acceptedAnswers?.length) {
        ctx.addIssue({ code: 'custom', message: 'Short answer needs at least one accepted answer' });
      }
    }
  });

export const createAssessmentSchema = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().max(5000).optional().default(''),
  questions: z.array(questionSchema).min(1),
});

export const updateAssessmentSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  description: z.string().max(5000).optional(),
  questions: z.array(questionSchema).min(1).optional(),
});

export const assignAssessmentSchema = z
  .object({
    studentIds: z.array(z.string().min(1)).optional().default([]),
    groupIds: z.array(z.string().min(1)).optional().default([]),
    dueDate: z.coerce.date().optional().nullable(),
    /** Defaults to the organization's current academic year */
    academicYearId: z.string().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.studentIds.length && !data.groupIds.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'At least one student or group must be selected',
      });
    }
  });

export const listMyAssignmentsQuery = z.object({
  /** Omit / empty = current year; "all" = every year */
  academicYearId: z.string().optional(),
});

export const listResultsQuery = z.object({
  academicYearId: z.string().optional(),
});

const answerInputSchema = z
  .object({
    questionId: z.string().min(1),
    selectedOptionIds: z.array(z.string().min(1)).optional().default([]),
    textAnswer: z.string().max(200).optional().default(''),
  })
  .superRefine((a, ctx) => {
    const hasOptions = a.selectedOptionIds.length > 0;
    const hasText = a.textAnswer.trim().length > 0;
    if (!hasOptions && !hasText) {
      ctx.addIssue({ code: 'custom', message: 'Answer must include a selection or text' });
    }
    if (hasText) {
      const words = a.textAnswer.trim().split(/\s+/).filter(Boolean);
      if (words.length > 2) {
        ctx.addIssue({ code: 'custom', message: 'Short answer must be 1–2 words' });
      }
    }
  });

export const submitAssessmentSchema = z.object({
  answers: z.array(answerInputSchema).min(1),
});

export const listAssessmentQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['draft', 'published', 'closed']).optional(),
});
