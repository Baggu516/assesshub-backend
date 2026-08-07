import { tokensToWords } from './kb.chunk.js';

/** UI / API chunking strategies (mutually exclusive). */
export const CHUNKING_STRATEGY_OPTIONS = ['original', 'semantic'];

export const DEFAULT_CHUNKING = {
  chunkingStrategy: 'semantic',
  chunkSize: 400,
  chunkOverlap: 80,
  // Off by default — local Ollama chat enrichment can block embedding for minutes.
  syntheticQuestions: false,
  autoSummary: false,
  multiHopSearch: true,
};

/**
 * Infer canonical strategy from new or legacy fields.
 * Legacy: sourceOnlyMode, semanticSplitting, chunkingStrategy in {source,recursive,fixed,semantic}.
 */
function inferChunkingStrategy(raw = {}) {
  const s = raw.chunkingStrategy;
  if (s === 'original' || s === 'semantic') return s;
  if (raw.sourceOnlyMode === true || s === 'source') return 'original';
  if (s === 'recursive' || s === 'fixed') return 'original';
  if (raw.semanticSplitting === false) return 'original';
  if (s === 'semantic' || raw.semanticSplitting === true) return 'semantic';
  // Default when unset: prefer semantic (previous default)
  if (raw.semanticSplitting === undefined && s == null && raw.sourceOnlyMode == null) {
    return DEFAULT_CHUNKING.chunkingStrategy;
  }
  return DEFAULT_CHUNKING.chunkingStrategy;
}

function clampInt(n, min, max, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

/**
 * Normalize config from DB / PATCH. Accepts legacy sourceOnlyMode, semanticSplitting,
 * targetTokens, overlapTokens as well as canonical chunkingStrategy / chunkSize / chunkOverlap.
 */
export function normalizeChunkingConfig(raw = {}) {
  // Prefer token aliases when they diverge from legacy word-count chunkSize writes.
  let sizeRaw;
  if (raw.chunkSize != null && raw.targetTokens != null && Number(raw.chunkSize) !== Number(raw.targetTokens)) {
    sizeRaw = raw.targetTokens;
  } else {
    sizeRaw = raw.chunkSize ?? raw.targetTokens ?? DEFAULT_CHUNKING.chunkSize;
  }

  let overlapRaw;
  if (
    raw.chunkOverlap != null &&
    raw.overlapTokens != null &&
    Number(raw.chunkOverlap) !== Number(raw.overlapTokens)
  ) {
    overlapRaw = raw.overlapTokens;
  } else {
    overlapRaw = raw.chunkOverlap ?? raw.overlapTokens ?? DEFAULT_CHUNKING.chunkOverlap;
  }

  let chunkSize = clampInt(sizeRaw, 100, 2000, DEFAULT_CHUNKING.chunkSize);
  let chunkOverlap = clampInt(overlapRaw, 0, 400, DEFAULT_CHUNKING.chunkOverlap);
  if (chunkOverlap >= chunkSize) {
    chunkOverlap = Math.max(0, chunkSize - 1);
  }

  return {
    chunkingStrategy: inferChunkingStrategy(raw),
    chunkSize,
    chunkOverlap,
    syntheticQuestions: raw.syntheticQuestions !== false,
    autoSummary: raw.autoSummary !== false,
    multiHopSearch: raw.multiHopSearch !== false,
  };
}

/** Canonical API shape for chunking settings. */
export function serializeChunkingSettings(raw = {}) {
  const c = normalizeChunkingConfig(raw);
  return {
    chunkingStrategy: c.chunkingStrategy,
    chunkSize: c.chunkSize,
    chunkOverlap: c.chunkOverlap,
    syntheticQuestions: c.syntheticQuestions,
    autoSummary: c.autoSummary,
    multiHopSearch: c.multiHopSearch,
    // Legacy aliases for older clients
    sourceOnlyMode: c.chunkingStrategy === 'original',
    semanticSplitting: c.chunkingStrategy === 'semantic',
    targetTokens: c.chunkSize,
    overlapTokens: c.chunkOverlap,
  };
}

/**
 * Map UI strategy + token budgets to chunkText() parameters.
 * Original → paragraph/fixed (source); Semantic → sentence-merge semantic.
 */
export function resolveChunkingParams(raw = {}) {
  const c = normalizeChunkingConfig(raw);
  const strategy = c.chunkingStrategy === 'original' ? 'source' : 'semantic';
  return {
    strategy,
    chunkSize: tokensToWords(c.chunkSize),
    chunkOverlap: tokensToWords(c.chunkOverlap),
  };
}

/** Fields to persist alongside embedding settings. */
export function toPersistedChunkingFields(raw = {}) {
  const c = normalizeChunkingConfig(raw);
  return {
    chunkingStrategy: c.chunkingStrategy,
    chunkSize: c.chunkSize,
    chunkOverlap: c.chunkOverlap,
    targetTokens: c.chunkSize,
    overlapTokens: c.chunkOverlap,
    sourceOnlyMode: c.chunkingStrategy === 'original',
    semanticSplitting: c.chunkingStrategy === 'semantic',
    syntheticQuestions: c.syntheticQuestions,
    autoSummary: c.autoSummary,
    multiHopSearch: c.multiHopSearch,
  };
}
