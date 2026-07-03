/**
 * Lightweight routing: when to run RAG vs workload-only (no extra LLM call).
 */

const GREETING_RE = /^(hi|hello|hey|thanks|thank you|ok|okay|good morning|good afternoon)\b[!.,?\s]*$/i;
const WORKLOAD_RE =
  /\b(assessment|assessments|submission|submissions|score|scores|student|students|pending|dashboard|assigned|completion|due date|my work|focus on|grade|grades|quiz|exam)\b/i;
const KNOWLEDGE_RE =
  /\b(policy|policies|prd|document|documents|upload|uploaded|manual|guide|handbook|requirement|requirements|feature|features|section|chapter|according to|in the doc|knowledge base|rentflow|product spec|specification|process|procedure|how do we|what does .+ say)\b/i;
const FOLLOW_UP_RE = /^(yes|no|why|how|what about|and |also |more|explain|elaborate|continue)\b/i;

/**
 * @typedef {'general' | 'workload_only' | 'knowledge_only' | 'knowledge_and_workload'} ChatIntent
 */

/**
 * @param {string} query - latest user message
 * @param {{ role: string, content: string }[]} history - prior messages (no latest)
 * @param {boolean} kbAvailable - org has indexed chunks
 * @returns {{ intent: ChatIntent, useKnowledgeBase: boolean, useWorkload: boolean, reason: string }}
 */
export function decideChatIntent(query, history, kbAvailable) {
  const q = (query || '').trim();
  const lower = q.toLowerCase();

  if (!q) {
    return { intent: 'general', useKnowledgeBase: false, useWorkload: true, reason: 'empty' };
  }

  if (!kbAvailable) {
    return { intent: 'workload_only', useKnowledgeBase: false, useWorkload: true, reason: 'no_kb' };
  }

  if (q.length < 24 && GREETING_RE.test(q)) {
    return { intent: 'general', useKnowledgeBase: false, useWorkload: true, reason: 'greeting' };
  }

  const wantsKnowledge = KNOWLEDGE_RE.test(lower);
  const wantsWorkload = WORKLOAD_RE.test(lower);

  if (wantsKnowledge && !wantsWorkload) {
    return {
      intent: 'knowledge_only',
      useKnowledgeBase: true,
      useWorkload: false,
      reason: 'knowledge_keywords',
    };
  }

  if (wantsWorkload && !wantsKnowledge) {
    return {
      intent: 'workload_only',
      useKnowledgeBase: false,
      useWorkload: true,
      reason: 'workload_keywords',
    };
  }

  if (wantsKnowledge && wantsWorkload) {
    return {
      intent: 'knowledge_and_workload',
      useKnowledgeBase: true,
      useWorkload: true,
      reason: 'mixed_keywords',
    };
  }

  // Short follow-ups in an ongoing thread: reuse cached KB, skip new RAG
  if (history.length > 0 && q.length < 80 && FOLLOW_UP_RE.test(lower)) {
    return {
      intent: 'knowledge_and_workload',
      useKnowledgeBase: true,
      useWorkload: true,
      reason: 'follow_up_reuse_cache',
    };
  }

  // Ambiguous: prefer workload only to avoid RAG on every vague question
  if (q.length < 40) {
    return {
      intent: 'workload_only',
      useKnowledgeBase: false,
      useWorkload: true,
      reason: 'short_ambiguous',
    };
  }

  // Longer general question — try knowledge (might be about org docs)
  return {
    intent: 'knowledge_and_workload',
    useKnowledgeBase: true,
    useWorkload: true,
    reason: 'default_both',
  };
}

/** Re-run vector search only when the topic likely shifted. */
export function shouldRefreshKnowledgeCache(newQuery, cachedQuery, intentReason) {
  if (intentReason === 'follow_up_reuse_cache') return false;
  if (!cachedQuery?.trim()) return true;

  const a = newQuery.trim().toLowerCase();
  const b = cachedQuery.trim().toLowerCase();
  if (a === b) return false;

  const aWords = new Set(a.split(/\W+/).filter((w) => w.length > 3));
  const bWords = new Set(b.split(/\W+/).filter((w) => w.length > 3));
  let overlap = 0;
  for (const w of aWords) {
    if (bWords.has(w)) overlap++;
  }
  const union = new Set([...aWords, ...bWords]).size || 1;
  const similarity = overlap / union;
  return similarity < 0.35;
}
