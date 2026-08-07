import mongoose from 'mongoose';
import { buildAiSystemPrompt, runAiChat } from './ai.service.js';
import { decideChatIntent, shouldRefreshKnowledgeCache } from './ai.intent.js';
import {
  retrieveKnowledgeContext,
  getKnowledgeBaseStatus,
  reprocessKbDocument,
} from '../kb/kb.service.js';

const MAX_CHATS_PER_USER = 50;
const MAX_MESSAGES_PER_CHAT = 40;

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function titleFromContent(content) {
  const t = content.trim().replace(/\s+/g, ' ');
  if (!t) return 'New chat';
  return t.length <= 80 ? t : `${t.slice(0, 77)}…`;
}

function serializeSources(sources) {
  if (!Array.isArray(sources) || !sources.length) return [];
  return sources.map((s) => ({
    documentId: String(s.documentId),
    title: s.title || '',
  }));
}

function serializeMessage(m) {
  const out = { role: m.role, content: m.content };
  if (m.role === 'user' && typeof m.knowledgeBaseUsed === 'boolean') {
    out.knowledgeBaseUsed = m.knowledgeBaseUsed;
  }
  if (m.role === 'user' && Array.isArray(m.knowledgeSources) && m.knowledgeSources.length) {
    out.knowledgeSources = serializeSources(m.knowledgeSources);
  }
  if (m.askedAt) out.askedAt = m.askedAt;
  if (m.role === 'assistant' && (m.feedback === 'up' || m.feedback === 'down')) {
    out.feedback = m.feedback;
    if (m.feedbackAt) out.feedbackAt = m.feedbackAt;
  }
  return out;
}

function serializeChat(doc) {
  return {
    id: String(doc._id),
    title: doc.title,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    messages: (doc.messages || []).map(serializeMessage),
  };
}

function serializeChatSummary(doc) {
  return {
    id: String(doc._id),
    title: doc.title,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    messageCount: doc.messages?.length ?? 0,
  };
}

export async function listAiChats(models, userId, orgId) {
  const { AiChatSession } = models;
  const orgOid = new mongoose.Types.ObjectId(String(orgId));
  const uid = new mongoose.Types.ObjectId(String(userId));

  const rows = await AiChatSession.aggregate([
    { $match: { orgId: orgOid, userId: uid } },
    { $sort: { updatedAt: -1 } },
    { $limit: MAX_CHATS_PER_USER },
    {
      $project: {
        title: 1,
        createdAt: 1,
        updatedAt: 1,
        messageCount: { $size: { $ifNull: ['$messages', []] } },
      },
    },
  ]);

  return rows.map((r) => ({
    id: String(r._id),
    title: r.title,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    messageCount: r.messageCount,
  }));
}

export async function createAiChat(models, userId, orgId) {
  const { AiChatSession } = models;
  const orgOid = new mongoose.Types.ObjectId(String(orgId));
  const uid = new mongoose.Types.ObjectId(String(userId));

  const count = await AiChatSession.countDocuments({ orgId: orgOid, userId: uid });
  if (count >= MAX_CHATS_PER_USER) {
    throw httpError(400, `You can have at most ${MAX_CHATS_PER_USER} saved chats. Delete one to create another.`);
  }

  const doc = await AiChatSession.create({
    orgId: orgOid,
    userId: uid,
    title: 'New chat',
    messages: [],
  });
  return serializeChat(doc.toObject());
}

export async function getAiChat(models, userId, orgId, chatId) {
  const { AiChatSession } = models;
  if (!mongoose.Types.ObjectId.isValid(chatId)) {
    throw httpError(400, 'Invalid chat id');
  }
  const orgOid = new mongoose.Types.ObjectId(String(orgId));
  const uid = new mongoose.Types.ObjectId(String(userId));
  const doc = await AiChatSession.findOne({
    _id: chatId,
    orgId: orgOid,
    userId: uid,
  }).lean();

  if (!doc) {
    throw httpError(404, 'Chat not found');
  }
  return serializeChat(doc);
}

export async function patchAiChatTitle(models, userId, orgId, chatId, title) {
  const { AiChatSession } = models;
  if (!mongoose.Types.ObjectId.isValid(chatId)) {
    throw httpError(400, 'Invalid chat id');
  }
  const orgOid = new mongoose.Types.ObjectId(String(orgId));
  const uid = new mongoose.Types.ObjectId(String(userId));

  const doc = await AiChatSession.findOneAndUpdate(
    { _id: chatId, orgId: orgOid, userId: uid },
    { $set: { title: title.trim() } },
    { new: true }
  ).lean();

  if (!doc) {
    throw httpError(404, 'Chat not found');
  }
  return serializeChatSummary(doc);
}

export async function deleteAiChat(models, userId, orgId, chatId) {
  const { AiChatSession } = models;
  if (!mongoose.Types.ObjectId.isValid(chatId)) {
    throw httpError(400, 'Invalid chat id');
  }
  const orgOid = new mongoose.Types.ObjectId(String(orgId));
  const uid = new mongoose.Types.ObjectId(String(userId));

  const r = await AiChatSession.deleteOne({ _id: chatId, orgId: orgOid, userId: uid });
  if (r.deletedCount === 0) {
    throw httpError(404, 'Chat not found');
  }
}

function trimStoredMessages(messages, max) {
  if (messages.length <= max) return messages;
  let slice = messages.slice(-max);
  while (slice.length > 0 && slice[0].role === 'assistant') {
    slice = slice.slice(1);
  }
  return slice;
}

/**
 * Append user message, call model, append assistant; persist.
 */
export async function replyInAiChat(models, actor, orgId, chatId, provider, content, options = {}) {
  const { AiChatSession } = models;
  if (!mongoose.Types.ObjectId.isValid(chatId)) {
    throw httpError(400, 'Invalid chat id');
  }
  const orgOid = new mongoose.Types.ObjectId(String(orgId));
  const uid = new mongoose.Types.ObjectId(String(actor._id));

  const doc = await AiChatSession.findOne({ _id: chatId, orgId: orgOid, userId: uid });
  if (!doc) {
    throw httpError(404, 'Chat not found');
  }

  let history = (doc.messages || []).map((m) => ({
    role: m.role,
    content: m.content,
    ...(m.role === 'user'
      ? {
          knowledgeBaseUsed: Boolean(m.knowledgeBaseUsed),
          knowledgeSources: serializeSources(m.knowledgeSources),
          ...(m.askedAt ? { askedAt: m.askedAt } : {}),
        }
      : {
          ...(m.feedback === 'up' || m.feedback === 'down' ? { feedback: m.feedback } : {}),
          ...(m.feedbackAt ? { feedbackAt: m.feedbackAt } : {}),
        }),
  }));
  while (history.length > 0 && history[0].role === 'assistant') {
    history.shift();
  }

  const forModel = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content },
  ];

  if (forModel.length === 0 || forModel[0].role !== 'user' || forModel[forModel.length - 1].role !== 'user') {
    throw httpError(400, 'Invalid message thread state');
  }

  const kbStatus = await getKnowledgeBaseStatus(models, orgId);
  const routing = decideChatIntent(content, history, kbStatus.available);

  let knowledgeContext = '';
  let knowledgeSources = [];
  let knowledgeRefreshed = false;

  if (routing.useKnowledgeBase) {
    const refresh = shouldRefreshKnowledgeCache(
      content,
      doc.cachedKnowledgeQuery,
      routing.reason
    );
    if (refresh) {
      const retrieved = await retrieveKnowledgeContext(models, orgId, content);
      knowledgeContext = retrieved.context || '';
      knowledgeSources = serializeSources(retrieved.sources);
      doc.cachedKnowledgeQuery = content;
      doc.cachedKnowledgeContext = knowledgeContext;
      doc.cachedKnowledgeSources = knowledgeSources;
      knowledgeRefreshed = Boolean(knowledgeContext.trim());
    } else if (doc.cachedKnowledgeContext?.trim()) {
      knowledgeContext = doc.cachedKnowledgeContext;
      knowledgeSources = serializeSources(doc.cachedKnowledgeSources);
    } else {
      const retrieved = await retrieveKnowledgeContext(models, orgId, content);
      knowledgeContext = retrieved.context || '';
      knowledgeSources = serializeSources(retrieved.sources);
      doc.cachedKnowledgeQuery = content;
      doc.cachedKnowledgeContext = knowledgeContext;
      doc.cachedKnowledgeSources = knowledgeSources;
      knowledgeRefreshed = Boolean(knowledgeContext.trim());
    }
  } else {
    doc.cachedKnowledgeQuery = '';
    doc.cachedKnowledgeContext = '';
    doc.cachedKnowledgeSources = [];
  }

  const knowledgeBaseUsed = Boolean(knowledgeContext?.trim());

  const intentLabel = {
    general: 'General help; use workload only.',
    workload_only: 'Focus on the user’s assessments and dashboard metrics only.',
    knowledge_only: 'Focus on organization knowledge base snippets only.',
    knowledge_and_workload: 'Combine organization knowledge with the user’s workload when both apply.',
  }[routing.intent];

  const systemText = await buildAiSystemPrompt(models, actor, orgId, {
    knowledgeContext,
    includeWorkload: routing.useWorkload,
    chatIntent: intentLabel,
  });
  const assistantContent = await runAiChat(provider, systemText, forModel, {
    model: options.model,
  });

  const combined = [
    ...history,
    {
      role: 'user',
      content,
      knowledgeBaseUsed,
      knowledgeSources: knowledgeBaseUsed ? knowledgeSources : [],
      askedAt: new Date(),
    },
    { role: 'assistant', content: assistantContent },
  ];
  const trimmed = trimStoredMessages(combined, MAX_MESSAGES_PER_CHAT);

  doc.messages.length = 0;
  for (const m of trimmed) {
    doc.messages.push(m);
  }

  if (!doc.title || doc.title === 'New chat') {
    doc.title = titleFromContent(content);
  }

  await doc.save();

  return {
    message: { role: 'assistant', content: assistantContent },
    chat: serializeChat(doc.toObject()),
    knowledgeBaseUsed,
    knowledgeSources: knowledgeBaseUsed ? knowledgeSources : [],
    chatIntent: routing.intent,
    knowledgeRefreshed,
  };
}

/**
 * Thumbs up/down on an assistant message.
 * Thumbs down + RAG sources → re-chunk those knowledge documents.
 */
export async function setAiChatMessageFeedback(models, userId, orgId, chatId, messageIndex, rating) {
  const { AiChatSession } = models;
  if (!mongoose.Types.ObjectId.isValid(chatId)) {
    throw httpError(400, 'Invalid chat id');
  }
  if (rating !== 'up' && rating !== 'down') {
    throw httpError(400, 'rating must be up or down');
  }
  const idx = Number(messageIndex);
  if (!Number.isInteger(idx) || idx < 0) {
    throw httpError(400, 'Invalid message index');
  }

  const orgOid = new mongoose.Types.ObjectId(String(orgId));
  const uid = new mongoose.Types.ObjectId(String(userId));
  const doc = await AiChatSession.findOne({ _id: chatId, orgId: orgOid, userId: uid });
  if (!doc) throw httpError(404, 'Chat not found');

  if (!doc.messages?.[idx] || doc.messages[idx].role !== 'assistant') {
    throw httpError(400, 'Feedback only applies to assistant messages');
  }

  doc.messages[idx].feedback = rating;
  doc.messages[idx].feedbackAt = new Date();
  await doc.save();

  let reprocessed = [];
  if (rating === 'down') {
    // Prefer sources from the preceding user turn.
    let sources = [];
    for (let i = idx - 1; i >= 0; i--) {
      if (doc.messages[i].role === 'user') {
        sources = serializeSources(doc.messages[i].knowledgeSources);
        break;
      }
    }
    const uniqueIds = [...new Set(sources.map((s) => s.documentId).filter(Boolean))];
    for (const documentId of uniqueIds) {
      try {
        const d = await reprocessKbDocument(models, orgId, documentId);
        reprocessed.push({ documentId, originalName: d.originalName, status: d.status });
      } catch (e) {
        console.warn('[kb] reprocess after feedback failed', documentId, e.message || e);
      }
    }
  }

  return {
    chat: serializeChat(doc.toObject()),
    feedback: rating,
    reprocessed,
  };
}
