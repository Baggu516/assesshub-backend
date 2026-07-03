import { tokensToWords } from './kb.chunk.js';

export const DEFAULT_CHUNKING = {
  sourceOnlyMode: false,
  semanticSplitting: true,
  syntheticQuestions: true,
  autoSummary: true,
  multiHopSearch: true,
  targetTokens: 400,
  overlapTokens: 80,
};

export function normalizeChunkingConfig(raw = {}) {
  return {
    ...DEFAULT_CHUNKING,
    sourceOnlyMode: Boolean(raw.sourceOnlyMode),
    semanticSplitting: raw.semanticSplitting !== false,
    syntheticQuestions: raw.syntheticQuestions !== false,
    autoSummary: raw.autoSummary !== false,
    multiHopSearch: raw.multiHopSearch !== false,
    targetTokens: raw.targetTokens ?? raw.chunkSize ?? DEFAULT_CHUNKING.targetTokens,
    overlapTokens: raw.overlapTokens ?? raw.chunkOverlap ?? DEFAULT_CHUNKING.overlapTokens,
  };
}

export function serializeChunkingSettings(raw = {}) {
  const c = normalizeChunkingConfig(raw);
  return {
    sourceOnlyMode: c.sourceOnlyMode,
    semanticSplitting: c.semanticSplitting,
    syntheticQuestions: c.syntheticQuestions,
    autoSummary: c.autoSummary,
    multiHopSearch: c.multiHopSearch,
    targetTokens: c.targetTokens,
    overlapTokens: c.overlapTokens,
  };
}

/** Map UI toggles + token budgets to chunkText() parameters. */
export function resolveChunkingParams(raw = {}) {
  const c = normalizeChunkingConfig(raw);
  if (c.sourceOnlyMode) {
    return { strategy: 'source', chunkSize: tokensToWords(c.targetTokens), chunkOverlap: 0 };
  }
  const strategy = c.semanticSplitting ? 'semantic' : 'recursive';
  return {
    strategy,
    chunkSize: tokensToWords(c.targetTokens),
    chunkOverlap: tokensToWords(c.overlapTokens),
  };
}
