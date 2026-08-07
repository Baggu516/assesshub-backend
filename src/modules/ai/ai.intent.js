/**
 * Lightweight routing: when to run RAG vs workload-only (no extra LLM call).
 * KB docs are school/org materials (policies, handbooks, curriculum, etc.).
 */

const GREETING_RE = /^(hi|hello|hey|thanks|thank you|ok|okay|good morning|good afternoon)\b[!.,?\s]*$/i;

/** Dashboard / assessment activity for this user (not school handbook content). */
const WORKLOAD_RE =
  /\b(my assessment|my assessments|my submission|my submissions|my score|my scores|my grade|my grades|pending assessment|dashboard|assigned to me|completion rate|due date|my work|focus on|quiz score|exam score)\b/i;

/**
 * School / org knowledge-base topics (handbooks, policies, curriculum, campus life).
 * Prefer RAG when these appear and indexed docs exist.
 */
const KNOWLEDGE_RE =
  /\b(policy|policies|document|documents|manual|guide|handbook|syllabus|curriculum|school|schools|campus|classroom|teacher|teachers|principal|parent|parents|guardian|fee|fees|tuition|admission|attendance|timetable|schedule|uniform|discipline|leave|holiday|holidays|exam rules|grading policy|promotion|section|chapter|according to|in the doc|knowledge base|requirement|requirements|procedure|procedures|how do we|what does .+ say|who is|what is|explain|tell me about)\b/i;

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

  // School KB is the main source for open questions — try RAG by default when docs exist.
  // Keep workload on longer questions so dashboard help still works.
  if (q.length < 40) {
    return {
      intent: 'knowledge_only',
      useKnowledgeBase: true,
      useWorkload: false,
      reason: 'short_prefer_kb',
    };
  }

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
