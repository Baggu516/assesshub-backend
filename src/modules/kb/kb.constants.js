/** `embedContent` on Google AI (v1beta) — see https://ai.google.dev/api/embeddings */
export const EMBEDDING_MODEL_OPTIONS = {
  gemini: ['gemini-embedding-001'],
  /** Runs locally via @xenova/transformers (no API key). */
  huggingface: ['Xenova/all-MiniLM-L6-v2', 'Xenova/bge-small-en-v1.5'],
};

export const DEFAULT_EMBEDDING_MODEL = {
  gemini: 'gemini-embedding-001',
  huggingface: 'Xenova/all-MiniLM-L6-v2',
};

/** Legacy DB/UI model ids → Xenova Transformers.js ids. */
export const HUGGINGFACE_MODEL_ALIASES = {
  'sentence-transformers/all-MiniLM-L6-v2': 'Xenova/all-MiniLM-L6-v2',
  'BAAI/bge-small-en-v1.5': 'Xenova/bge-small-en-v1.5',
};

/** Legacy UI/DB values mapped to a supported Gemini embedding model id. */
export const GEMINI_EMBEDDING_ALIASES = {
  'text-embedding-004': 'gemini-embedding-001',
  'embedding-001': 'gemini-embedding-001',
};

export const ALLOWED_EXTENSIONS = new Set(['pdf', 'docx', 'html', 'htm', 'txt']);
