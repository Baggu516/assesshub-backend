import { dashboardForActor } from '../reports/reports.service.js';

const FETCH_TIMEOUT_MS = 28_000;

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const DEFAULT_INTENTIONS = `- Help the user interpret their dashboard and assessment activity.
- When organization knowledge base snippets are provided, use them for policies, study guides, and process questions for this tenant.
- Ground factual claims in dashboard data and/or knowledge base snippets—never invent facts.
- Prefer short, scannable answers; add detail only when the user asks for it.
- Use clear, professional language suitable for education.`;

const DEFAULT_CONSTRAINTS = `- Do not invent assessments, scores, students, dates, counts, or document content not present in the sections below.
- Knowledge base content is shared for the whole organization (tenant); do not claim it is private to one user.
- Do not imply you can see other tenants or organizations.
- If the data is insufficient to answer, say what is missing instead of guessing.
- Do not give legal, medical, or financial advice; stay within education and assessment context.
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
    const dash = await dashboardForActor(models, actor, orgId);
    workloadBlock = `\n## Dashboard data (JSON)\n${JSON.stringify(dash)}`;
  }

  return `You are the dashboard AI assistant for AssessHub, an education assessment platform.

## Intentions
${DEFAULT_INTENTIONS}${extraIntentions}
## Constraints
${DEFAULT_CONSTRAINTS}${extraConstraints}${modeBlock}${workloadBlock}${kbBlock}`;
}

async function groqChat(systemText, messages, apiKey) {
  const openAIMessages = [
    { role: 'system', content: systemText },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

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
        max_tokens: 1024,
        temperature: 0.35,
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

async function geminiChat(systemText, messages, apiKey) {
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
      maxOutputTokens: 1024,
      temperature: 0.35,
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

/**
 * @param {'gemini'|'groq'} provider
 * @param {string} systemText
 * @param {{ role: 'user'|'assistant', content: string }[]} messages
 */
export async function runAiChat(provider, systemText, messages) {
  if (provider === 'groq') {
    const key = process.env.GROQ_API_KEY?.trim();
    if (!key) throw httpError(503, 'Groq is not configured (missing GROQ_API_KEY)');
    return groqChat(systemText, messages, key);
  }

  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw httpError(503, 'Gemini is not configured (missing GEMINI_API_KEY)');
  return geminiChat(systemText, messages, key);
}

export function aiProviderAvailability() {
  return {
    gemini: Boolean(process.env.GEMINI_API_KEY?.trim()),
    groq: Boolean(process.env.GROQ_API_KEY?.trim()),
  };
}
