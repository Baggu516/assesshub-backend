import { z } from 'zod';
import { questionSchema } from '../assessment/assessment.schemas.js';
import { resolveDefaultAiProvider, runAiChat } from './ai.service.js';

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const draftSchema = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().max(5000).optional().default(''),
  questions: z.array(questionSchema).min(1).max(20),
});

const SYSTEM_PROMPT = `You create school assessment drafts for ClassTrio.

Return ONLY valid JSON (no markdown fences, no commentary) with this shape:
{
  "title": "string",
  "description": "string",
  "questions": [
    {
      "type": "single_select" | "multi_select" | "short_answer",
      "prompt": "question text",
      "points": 1,
      "order": 0,
      "options": [{ "text": "option", "isCorrect": true|false }],
      "acceptedAnswers": ["word"],
      "caseSensitive": false
    }
  ]
}

Style (very important):
- Prefer short, exam-style questions: one clear sentence, no essays.
- Prefer single_select (MCQ) for most items.
- Options must be short labels (1–5 words), not paragraphs.
- Do NOT put option numbers (1. 2. 3.) inside option text — the UI shows choices.
- Do NOT put the answer choices inside the prompt text.
- Use the teacher's topic and level; invent plausible distractors.

Example of good single_select output:
{
  "type": "single_select",
  "prompt": "What is React?",
  "points": 1,
  "order": 0,
  "options": [
    { "text": "A JavaScript library", "isCorrect": true },
    { "text": "A programming language", "isCorrect": false },
    { "text": "A database", "isCorrect": false },
    { "text": "An operating system", "isCorrect": false }
  ],
  "acceptedAnswers": [],
  "caseSensitive": false
}

Rules:
- Mix types only when the teacher prompt asks for it; otherwise mostly single_select.
- single_select: 3–4 options, exactly one isCorrect true.
- multi_select: at least 2 options, at least one isCorrect true.
- short_answer: acceptedAnswers with 1–3 word answers; options must be [].
- For select types, acceptedAnswers must be [].
- Mark correct answers accurately for the subject.
- Keep language clear for teachers and students.
- order must be 0-based sequential.
- points should be a positive number (usually 1).`;

function extractJsonObject(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw httpError(502, 'AI returned an empty response');

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : trimmed).trim();

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    throw httpError(502, 'AI returned invalid JSON for the assessment draft');
  }
}

function normalizeDraft(raw) {
  const questions = Array.isArray(raw?.questions) ? raw.questions : [];
  return {
    title: String(raw?.title || 'Untitled assessment').trim().slice(0, 500),
    description: String(raw?.description || '').trim().slice(0, 5000),
    questions: questions.map((q, index) => {
      const type = q?.type;
      const base = {
        type,
        prompt: String(q?.prompt || '').trim(),
        points: Number(q?.points) > 0 ? Number(q.points) : 1,
        order: index,
        options: [],
        acceptedAnswers: [],
        caseSensitive: Boolean(q?.caseSensitive),
      };

      if (type === 'short_answer') {
        const answers = Array.isArray(q?.acceptedAnswers) ? q.acceptedAnswers : [];
        base.acceptedAnswers = answers
          .map((a) => String(a || '').trim())
          .filter(Boolean)
          .slice(0, 8);
        return base;
      }

      const options = Array.isArray(q?.options) ? q.options : [];
      base.options = options
        .map((o) => ({
          text: String(o?.text || '').trim(),
          isCorrect: Boolean(o?.isCorrect),
        }))
        .filter((o) => o.text)
        .slice(0, 8);

      if (type === 'single_select') {
        const correctIdx = base.options.findIndex((o) => o.isCorrect);
        base.options = base.options.map((o, i) => ({
          ...o,
          isCorrect: correctIdx >= 0 ? i === correctIdx : i === 0,
        }));
      }

      return base;
    }),
  };
}

/**
 * @param {{ prompt: string, questionCount?: number, provider?: string, model?: string }} input
 */
export async function generateAssessmentDraft(input) {
  const prompt = String(input.prompt || '').trim();
  if (!prompt) throw httpError(400, 'Prompt is required');

  const questionCount = Math.min(20, Math.max(1, Number(input.questionCount) || 5));
  const provider = resolveDefaultAiProvider(input.provider);

  const userContent = `Create an assessment draft from this teacher prompt.

Target number of questions: ${questionCount}

Prefer short multiple-choice (single_select) items like:
"What is React?" with short options such as "A JavaScript library", "A framework", "A database".

Teacher prompt:
${prompt.slice(0, 4000)}`;

  const rawText = await runAiChat(
    provider,
    SYSTEM_PROMPT,
    [{ role: 'user', content: userContent }],
    {
      model: input.model,
      maxTokens: 4096,
      temperature: 0.4,
    }
  );

  const parsed = extractJsonObject(rawText);
  const normalized = normalizeDraft(parsed);
  const validated = draftSchema.safeParse(normalized);

  if (!validated.success) {
    const detail = validated.error.issues?.[0]?.message || 'validation failed';
    throw httpError(502, `AI draft was incomplete (${detail}). Try a clearer prompt.`);
  }

  return {
    ...validated.data,
    provider,
  };
}
