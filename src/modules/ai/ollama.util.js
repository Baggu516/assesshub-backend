/** Shared Ollama base URL + model helpers. */

export function ollamaBaseUrl() {
  return (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
}

/** True when Ollama is opted in via env (does not probe the daemon). */
export function ollamaConfigured() {
  if (process.env.OLLAMA_ENABLED === 'false') return false;
  return Boolean(
    process.env.OLLAMA_ENABLED === 'true' ||
      process.env.OLLAMA_BASE_URL?.trim() ||
      process.env.OLLAMA_CHAT_MODEL?.trim()
  );
}

export function ollamaChatModels() {
  const main = (process.env.OLLAMA_CHAT_MODEL || 'gemma3:4b').trim();
  const alt = (process.env.OLLAMA_CHAT_MODEL_ALT || '').trim();
  const models = [{ id: main, label: labelForModel(main), role: 'main' }];
  if (alt && alt !== main) {
    models.push({ id: alt, label: labelForModel(alt), role: 'alt' });
  }
  return models;
}

export function resolveOllamaChatModel(requested) {
  const models = ollamaChatModels();
  const ids = models.map((m) => m.id);
  if (requested && ids.includes(requested)) return requested;
  return models[0].id;
}

function labelForModel(id) {
  const known = {
    'gemma3:4b': 'Gemma 3 4B',
    'gemma3:4b-it': 'Gemma 3 4B',
    'qwen2.5:3b': 'Qwen 2.5 3B',
    'qwen2.5:3b-instruct': 'Qwen 2.5 3B',
    'nomic-embed-text': 'nomic-embed-text',
  };
  if (known[id]) return known[id];
  return id;
}
