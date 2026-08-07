/** Embedding models via local Ollama (`OLLAMA_BASE_URL`). */
export const EMBEDDING_MODEL_OPTIONS = {
  ollama: ['nomic-embed-text'],
};

export const DEFAULT_EMBEDDING_MODEL = {
  ollama: 'nomic-embed-text',
};

export const ALLOWED_EXTENSIONS = new Set(['pdf', 'docx', 'html', 'htm', 'txt']);
