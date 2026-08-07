import { EMBEDDING_PROVIDERS } from '../../models/KnowledgeBaseConfig.js';
import { DEFAULT_EMBEDDING_MODEL } from './kb.constants.js';
import { ollamaBaseUrl, ollamaConfigured } from '../ai/ollama.util.js';

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

export function resolveEmbeddingModel(provider, model) {
  const m = (model || '').trim();
  if (provider === 'ollama') {
    if (!m) return DEFAULT_EMBEDDING_MODEL.ollama;
    return m;
  }
  return DEFAULT_EMBEDDING_MODEL.ollama;
}

export function embeddingProviderConfigured(provider) {
  if (!EMBEDDING_PROVIDERS.includes(provider)) return false;
  if (provider === 'ollama') return ollamaConfigured();
  return false;
}

async function embedOllama(text, model) {
  if (!ollamaConfigured()) {
    throw httpError(503, 'Ollama is not configured (set OLLAMA_BASE_URL or OLLAMA_ENABLED=true)');
  }

  const base = ollamaBaseUrl();
  const tryEmbed = async (path, body) => {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { res, json };
  };

  let { res, json } = await tryEmbed('/api/embed', { model, input: text });
  if (res.ok) {
    const vectors = json?.embeddings;
    if (Array.isArray(vectors?.[0])) return vectors[0];
    if (Array.isArray(json?.embedding)) return json.embedding;
  }

  ({ res, json } = await tryEmbed('/api/embeddings', { model, prompt: text }));
  if (!res.ok) {
    const msg = json?.error || json?.message || 'Ollama embedding failed';
    throw httpError(502, typeof msg === 'string' ? msg : 'Ollama embedding failed');
  }
  const values = json?.embedding;
  if (!Array.isArray(values)) throw httpError(502, 'Ollama returned no embedding vector');
  return values;
}

export async function embedText(provider, model, text) {
  const trimmed = text.slice(0, 8000);
  const resolved = resolveEmbeddingModel(provider, model);

  if (provider !== 'ollama') {
    throw httpError(400, 'Only Ollama embeddings are supported');
  }
  return embedOllama(trimmed, resolved);
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
