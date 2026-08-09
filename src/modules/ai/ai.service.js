import { aiWorkloadSnapshot } from '../reports/reports.service.js';
import {
  ollamaBaseUrl,
  ollamaChatModels,
  ollamaConfigured,
  resolveOllamaChatModel,
} from './ollama.util.js';

const FETCH_TIMEOUT_MS = 28_000;
/** Local models can be slower on first load. */
const OLLAMA_FETCH_TIMEOUT_MS = 120_000;

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const DEFAULT_INTENTIONS = `- Help the user interpret their dashboard and assessment activity.
- Organization knowledge base documents are school/org materials (handbooks, policies, curriculum, procedures). Prefer those snippets for school-related questions.
- When knowledge base snippets are provided AND they directly answer the question, use them and cite the source title.
- When workload JSON is provided, answer from it directly. Never ask the user to check the dashboard for data already present.
- For pending / focus / progress questions: use summary.pendingCount, summary.pendingItems, summary.submittedCount, and summary.submittedItems first. These match the dashboard cards.
- assignmentStatus "pending" = not turned in. assignmentStatus "submitted" = turned in. publicationStatus "published" only means the quiz is live — it is NOT pending work.
- If pendingCount is 0, say there is nothing left to turn in; do not invent pending items from due dates or publicationStatus.
- For scores, use assignment rows with assignmentStatus "submitted" (score, maxScore, scorePercent).
- When scoreIsLow is true or summary.reviewPlan is non-empty: give concrete study coaching — say the score is low, tell them to open that assessment’s results, go through each incorrectQuestions.prompt, and study that topic/concept before moving on. Name 1–3 missed question themes from the prompts; do not invent questions not listed.
- If pendingCount is 0 but reviewPlan has items, “what should I focus on” should prioritize reviewing wrong answers / weak topics, not inventing new pending work.
- When role is admin (or summary.byTeacher is present): answer with a per-teacher breakdown — “Under {teacherName}: {completed} completed, {pending} pending” (and avg score if present). Then end with one short overall suggestion (who to follow up with, or what leaders should watch). Do not invent teachers not listed.
- Do not contradict yourself: completed/submitted have scores; pending means not turned in yet.
- Ground factual claims in the JSON and/or knowledge base snippets—never invent facts.
- Keep answers concise and actionable. No filler closings.`;

const DEFAULT_CONSTRAINTS = `- Do not invent assessments, scores, students, dates, counts, missed questions, or document content not present in the sections below.
- Do not suggest reviewing the knowledge base, policies, or “additional resources” unless a knowledge base section is present below and those snippets are actually relevant to the question.
- Do not add polite padding like “feel free to ask”, “if you need further assistance”, or similar sign-offs.
- Knowledge base content is shared for the whole school/organization (tenant); do not claim it is private to one user.
- Do not imply you can see other tenants or organizations.
- If the data is insufficient to answer, say what is missing instead of guessing.
- Do not give legal, medical, or financial advice; stay within education and school assessment context.
- If the user asks you to change data in the app, explain they must do it in the UI—you only explain and suggest.`;

export async function buildAiSystemPrompt(models, actor, orgId, options = {}) {
  const includeWorkload = options.includeWorkload !== false;

  const intentionsExtra = (process.env.AI_CHAT_INTENTIONS_EXTRA ?? '').trim().slice(0, 2000);
  const constraintsExtra = (process.env.AI_CHAT_CONSTRAINTS_EXTRA ?? '').trim().slice(0, 2000);
  const extraIntentions = intentionsExtra
    ? `\nAdditional intentions (from operator configuration):\n${intentionsExtra}\n`
    : '';
  const extraConstraints = constraintsExtra
    ? `\nAdditional constraints (from operator configuration):\n${constraintsExtra}\n`
    : '';

  const modeBlock = options.chatIntent
    ? `\n## Reply mode for this turn\n${options.chatIntent}\n`
    : '';

  const kbBlock = options.knowledgeContext
    ? `\n## Organization knowledge base (shared for all users in this tenant — retrieved for this question)\nUse these snippets when they answer the user. Cite the source title when possible.\n${options.knowledgeContext}\n`
    : '';

  let workloadBlock = '';
  if (includeWorkload) {
    const snapshot = await aiWorkloadSnapshot(models, actor, orgId);
    const adminHint =
      actor.hierarchyRole === 'admin'
        ? '\nAdmin format: (1) per-teacher completed/pending from summary.byTeacher (2) one overall suggestion at the end.'
        : '';
    workloadBlock = `\n## Workload and submission activity (JSON)\nAuthoritative for this user’s assessments. Prefer summary.* for counts. assignmentStatus pending/submitted is turn-in state; publicationStatus is only draft/published/closed.${adminHint}\n${JSON.stringify(snapshot)}`;
  }

  return `You are the dashboard AI assistant for AssessHub, an education assessment platform.

## Intentions
${DEFAULT_INTENTIONS}${extraIntentions}
## Constraints
${DEFAULT_CONSTRAINTS}${extraConstraints}${modeBlock}${workloadBlock}${kbBlock}`;
}

async function groqChat(systemText, messages, apiKey, options = {}) {
  const openAIMessages = [
    { role: 'system', content: systemText },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const maxTokens = options.maxTokens || 1024;

  let res;
  try {
    res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.GROQ_CHAT_MODEL,
        messages: openAIMessages,
        max_tokens: maxTokens,
        temperature: options.temperature ?? 0.35,
      }),
    });
  } finally {
    clearTimeout(t);
  }

  const raw = await res.text();
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw httpError(502, 'Groq returned a non-JSON response');
  }

  if (!res.ok) {
    const msg = json?.error?.message || json?.message || `Groq error (${res.status})`;
    throw httpError(res.status >= 500 ? 502 : 502, msg);
  }

  const text = json?.choices?.[0]?.message?.content;
  if (!text || typeof text !== 'string') {
    throw httpError(502, 'Groq returned an empty reply');
  }
  return text.trim();
}

async function geminiChat(systemText, messages, apiKey, options = {}) {
  const model = encodeURIComponent(process.env.GEMINI_CHAT_MODEL);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const contents = [];
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'model' : 'user';
    contents.push({ role, parts: [{ text: m.content }] });
  }

  const body = {
    systemInstruction: { parts: [{ text: systemText }] },
    contents,
    generationConfig: {
      maxOutputTokens: options.maxTokens || 1024,
      temperature: options.temperature ?? 0.35,
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } finally {
    clearTimeout(timer);
  }

  const raw = await res.text();
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw httpError(502, 'Gemini returned a non-JSON response');
  }

  if (!res.ok) {
    const msg = json?.error?.message || `Gemini error (${res.status})`;
    throw httpError(502, msg);
  }

  const parts = json?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts) ? parts.map((p) => p.text || '').join('') : '';
  if (!text.trim()) {
    const block = json?.promptFeedback?.blockReason;
    throw httpError(502, block ? `Gemini blocked the request (${block})` : 'Gemini returned an empty reply');
  }
  return text.trim();
}

async function ollamaChat(systemText, messages, model, options = {}) {
  const openAIMessages = [
    { role: 'system', content: systemText },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), OLLAMA_FETCH_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(`${ollamaBaseUrl()}/api/chat`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: openAIMessages,
        stream: false,
        options: {
          temperature: options.temperature ?? 0.35,
          num_predict: options.maxTokens || 1024,
        },
      }),
    });
  } finally {
    clearTimeout(t);
  }

  const raw = await res.text();
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw httpError(502, 'Ollama returned a non-JSON response');
  }

  if (!res.ok) {
    const msg = json?.error || json?.message || `Ollama error (${res.status})`;
    throw httpError(502, typeof msg === 'string' ? msg : 'Ollama request failed');
  }

  const text = json?.message?.content;
  if (!text || typeof text !== 'string') {
    throw httpError(502, 'Ollama returned an empty reply');
  }
  return text.trim();
}

/**
 * @param {'gemini'|'groq'|'ollama'} provider
 * @param {string} systemText
 * @param {{ role: 'user'|'assistant', content: string }[]} messages
 * @param {{ model?: string, maxTokens?: number, temperature?: number }} [options]
 */
export async function runAiChat(provider, systemText, messages, options = {}) {
  if (provider === 'groq') {
    const key = process.env.GROQ_API_KEY?.trim();
    if (!key) throw httpError(503, 'Groq is not configured (missing GROQ_API_KEY)');
    return groqChat(systemText, messages, key, options);
  }

  if (provider === 'ollama') {
    if (!ollamaConfigured()) {
      throw httpError(503, 'Ollama is not configured (set OLLAMA_BASE_URL or OLLAMA_ENABLED=true)');
    }
    const model = resolveOllamaChatModel(options.model);
    return ollamaChat(systemText, messages, model, options);
  }

  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw httpError(503, 'Gemini is not configured (missing GEMINI_API_KEY)');
  return geminiChat(systemText, messages, key, options);
}

/** Prefer Ollama (local), then Gemini, then Groq. */
export function resolveDefaultAiProvider(requested) {
  const availability = aiProviderAvailability();
  if (requested === 'ollama' && availability.ollama) return 'ollama';
  if (requested === 'gemini' && availability.gemini) return 'gemini';
  if (requested === 'groq' && availability.groq) return 'groq';
  if (availability.ollama) return 'ollama';
  if (availability.gemini) return 'gemini';
  if (availability.groq) return 'groq';
  throw httpError(503, 'No AI provider is configured on the server');
}

export function aiProviderAvailability() {
  return {
    gemini: Boolean(process.env.GEMINI_API_KEY?.trim()),
    groq: Boolean(process.env.GROQ_API_KEY?.trim()),
    ollama: ollamaConfigured(),
    ollamaModels: ollamaConfigured() ? ollamaChatModels() : [],
  };
}
