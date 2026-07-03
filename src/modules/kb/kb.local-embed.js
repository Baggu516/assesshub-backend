import { HUGGINGFACE_MODEL_ALIASES } from './kb.constants.js';

const extractorCache = new Map();

export function toXenovaModelId(model) {
  const m = (model || '').trim();
  return HUGGINGFACE_MODEL_ALIASES[m] || m;
}

async function getExtractor(xenovaModelId) {
  let pending = extractorCache.get(xenovaModelId);
  if (!pending) {
    pending = (async () => {
      const { pipeline } = await import('@xenova/transformers');
      return pipeline('feature-extraction', xenovaModelId);
    })();
    extractorCache.set(xenovaModelId, pending);
  }
  return pending;
}

/** Local embeddings via Transformers.js (no Hugging Face API key). */
export async function embedLocalHuggingFace(text, model) {
  const xenovaId = toXenovaModelId(model);
  const extractor = await getExtractor(xenovaId);
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}
