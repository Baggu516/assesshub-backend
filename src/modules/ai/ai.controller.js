import { asyncHandler } from '../../utils/asyncHandler.js';
import { buildAiSystemPrompt, runAiChat, aiProviderAvailability } from './ai.service.js';
import { retrieveKnowledgeContext, getKnowledgeBaseStatus } from '../kb/kb.service.js';
import { decideChatIntent } from './ai.intent.js';
import * as aiChats from './ai.chats.service.js';

export const getAiProviders = asyncHandler(async (_req, res) => {
  res.json(aiProviderAvailability());
});

/** Any tenant user: is org knowledge base available for AI chat? */
export const getAiKnowledgeStatus = asyncHandler(async (req, res) => {
  const status = await getKnowledgeBaseStatus(req.tenantModels, req.tenant.orgId);
  res.json(status);
});

export const listAiChatsHandler = asyncHandler(async (req, res) => {
  const chats = await aiChats.listAiChats(req.tenantModels, req.user._id, req.tenant.orgId);
  res.json({ chats });
});

export const createAiChatHandler = asyncHandler(async (req, res) => {
  const chat = await aiChats.createAiChat(req.tenantModels, req.user._id, req.tenant.orgId);
  res.status(201).json({ chat });
});

export const getAiChatHandler = asyncHandler(async (req, res) => {
  const chat = await aiChats.getAiChat(req.tenantModels, req.user._id, req.tenant.orgId, req.params.id);
  res.json({ chat });
});

export const patchAiChatHandler = asyncHandler(async (req, res) => {
  const summary = await aiChats.patchAiChatTitle(
    req.tenantModels,
    req.user._id,
    req.tenant.orgId,
    req.params.id,
    req.body.title
  );
  res.json({ chat: summary });
});

export const deleteAiChatHandler = asyncHandler(async (req, res) => {
  await aiChats.deleteAiChat(req.tenantModels, req.user._id, req.tenant.orgId, req.params.id);
  res.status(204).send();
});

export const postAiChatReplyHandler = asyncHandler(async (req, res) => {
  const { provider, content, model } = req.body;
  const result = await aiChats.replyInAiChat(
    req.tenantModels,
    req.user,
    req.tenant.orgId,
    req.params.id,
    provider,
    content,
    { model }
  );
  res.json(result);
});

export const postAiChatFeedbackHandler = asyncHandler(async (req, res) => {
  const { messageIndex, rating } = req.body;
  const result = await aiChats.setAiChatMessageFeedback(
    req.tenantModels,
    req.user._id,
    req.tenant.orgId,
    req.params.id,
    messageIndex,
    rating
  );
  res.json(result);
});

export const postAiChat = asyncHandler(async (req, res) => {
  const { provider, messages, model } = req.body;
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const query = lastUser?.content || '';
  const history = messages.slice(0, -1);
  const kbStatus = await getKnowledgeBaseStatus(req.tenantModels, req.tenant.orgId);
  const routing = decideChatIntent(query, history, kbStatus.available);
  let knowledgeContext = '';
  let knowledgeSources = [];
  if (routing.useKnowledgeBase) {
    const retrieved = await retrieveKnowledgeContext(req.tenantModels, req.tenant.orgId, query);
    knowledgeContext = retrieved.context || '';
    knowledgeSources = retrieved.sources || [];
  }
  const intentLabel = {
    general: 'General help; use workload only.',
    workload_only: 'Focus on assessments and dashboard metrics only.',
    knowledge_only: 'Focus on organization knowledge base only.',
    knowledge_and_workload: 'Combine knowledge base with workload when both apply.',
  }[routing.intent];
  const systemText = await buildAiSystemPrompt(req.tenantModels, req.user, req.tenant.orgId, {
    knowledgeContext,
    includeWorkload: routing.useWorkload,
    chatIntent: intentLabel,
  });
  const content = await runAiChat(provider, systemText, messages, { model });
  res.json({
    message: { role: 'assistant', content },
    knowledgeBaseUsed: Boolean(knowledgeContext?.trim()),
    knowledgeSources,
    chatIntent: routing.intent,
  });
});
