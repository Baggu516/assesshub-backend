import { env } from '../../config/env.js';
import { EMBEDDING_PROVIDERS } from '../../models/KnowledgeBaseConfig.js';
import {
  DEFAULT_EMBEDDING_MODEL,
  GEMINI_EMBEDDING_ALIASES,
  HUGGINGFACE_MODEL_ALIASES,
} from './kb.constants.js';
import { embedLocalHuggingFace } from './kb.local-embed.js';

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

export function resolveEmbeddingModel(provider, model) {
  const m = (model || '').trim();
  if (provider === 'gemini') {
    if (!m) return DEFAULT_EMBEDDING_MODEL.gemini;
    return GEMINI_EMBEDDING_ALIASES[m] || m;
  }
  if (provider === 'huggingface') {
    if (!m) return DEFAULT_EMBEDDING_MODEL.huggingface;
    return HUGGINGFACE_MODEL_ALIASES[m] || m;
  }
  if (m) return m;
  return DEFAULT_EMBEDDING_MODEL[provider] || DEFAULT_EMBEDDING_MODEL.gemini;
}

export function embeddingProviderConfigured(provider) {
  if (!EMBEDDING_PROVIDERS.includes(provider)) return false;
  switch (provider) {
    case 'gemini':
      return Boolean(env.GEMINI_API_KEY?.trim());
    case 'huggingface':
      return true;
    default:
      return false;
  }
}

async function embedGemini(text, model) {
  const key = env.GEMINI_API_KEY?.trim();
  if (!key) throw httpError(503, 'Gemini embeddings not configured (GEMINI_API_KEY)');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:embedContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `models/${model}`,
      content: { parts: [{ text }] },
      taskType: 'RETRIEVAL_DOCUMENT',
    }),
  });
  const json = await res.json();
  if (!res.ok) throw httpError(502, json?.error?.message || 'Gemini embedding failed');
  const values = json?.embedding?.values;
  if (!Array.isArray(values)) throw httpError(502, 'Gemini returned no embedding vector');
  return values;
}

export async function embedText(provider, model, text) {
  const trimmed = text.slice(0, 8000);
  const resolved = resolveEmbeddingModel(provider, model);

  switch (provider) {
    case 'gemini':
      return embedGemini(trimmed, resolved);
    case 'huggingface':
      try {
        return await embedLocalHuggingFace(trimmed, resolved);
      } catch (e) {
        throw httpError(502, e?.message || 'Local Hugging Face embedding failed');
      }
    default:
      throw httpError(400, 'Unknown embedding provider');
  }
}

export async function embedTexts(provider, model, texts) {
  const vectors = [];
  for (const t of texts) {
    vectors.push(await embedText(provider, model, t));
  }
  return vectors;
}

export function cosineSimilarity(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return -1;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : -1;
}
