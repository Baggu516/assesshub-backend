const FETCH_TIMEOUT_MS = 25_000;

function llmConfigured() {
  return Boolean(process.env.GEMINI_API_KEY?.trim() || process.env.GROQ_API_KEY?.trim());
}

async function geminiGenerate(prompt) {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return null;

  const model = encodeURIComponent(process.env.GEMINI_CHAT_MODEL);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 512, temperature: 0.2 },
      }),
    });
    const json = await res.json();
    if (!res.ok) return null;
    const parts = json?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts) ? parts.map((p) => p.text || '').join('') : '';
    return text.trim() || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function groqGenerate(prompt) {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.GROQ_CHAT_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 512,
        temperature: 0.2,
      }),
    });
    const json = await res.json();
    if (!res.ok) return null;
    return json?.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function generateText(prompt) {
  if (!llmConfigured()) return null;
  const gemini = await geminiGenerate(prompt);
  if (gemini) return gemini;
  return groqGenerate(prompt);
}

function parseJsonArray(raw) {
  if (!raw) return [];
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const arr = JSON.parse(match[0]);
    return Array.isArray(arr) ? arr.map((s) => String(s).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** Document-level summary chunk for retrieval. */
export async function generateDocumentSummary(text, title) {
  const excerpt = text.slice(0, 12_000);
  const prompt = `Summarize the following document "${title}" in 120-200 words for semantic search retrieval. Use plain prose only, no markdown.\n\n---\n${excerpt}`;
  const summary = await generateText(prompt);
  return summary || null;
}

/** Search-oriented question variants for a document. */
export async function generateSyntheticQuestions(text, title, max = 6) {
  const excerpt = text.slice(0, 10_000);
  const prompt = `Read this document excerpt titled "${title}". Write up to ${max} short questions a user might search for that this document answers. Return ONLY a JSON array of strings, no other text.\n\n---\n${excerpt}`;
  const raw = await generateText(prompt);
  const questions = parseJsonArray(raw).slice(0, max);
  return questions.map((q) => `Question: ${q}`);
}

export function enrichmentAvailable() {
  return llmConfigured();
}
