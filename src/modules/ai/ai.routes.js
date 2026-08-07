import { Router } from 'express';
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireAiPlan } from '../../middleware/plan.middleware.js';
import { aiLimiter } from '../../middleware/rateLimit.middleware.js';
import { validateBody } from '../../middleware/validate.middleware.js';
import {
  aiChatBodySchema,
  aiChatReplyBodySchema,
  aiChatPatchBodySchema,
  aiChatFeedbackBodySchema,
} from './ai.schemas.js';
import {
  getAiProviders,
  getAiKnowledgeStatus,
  postAiChat,
  listAiChatsHandler,
  createAiChatHandler,
  getAiChatHandler,
  patchAiChatHandler,
  deleteAiChatHandler,
  postAiChatReplyHandler,
  postAiChatFeedbackHandler,
} from './ai.controller.js';

const r = Router();

/** Same bar as dashboard: any active tenant user (workload context mirrors reports/dashboard). */
r.use(tenantMiddleware, requireAuth, requireAiPlan, aiLimiter);

r.get('/providers', getAiProviders);
r.get('/knowledge-status', getAiKnowledgeStatus);
r.get('/chats', listAiChatsHandler);
r.post('/chats', createAiChatHandler);
r.get('/chats/:id', getAiChatHandler);
r.patch('/chats/:id', validateBody(aiChatPatchBodySchema), patchAiChatHandler);
r.delete('/chats/:id', deleteAiChatHandler);
r.post('/chats/:id/reply', validateBody(aiChatReplyBodySchema), postAiChatReplyHandler);
r.post('/chats/:id/feedback', validateBody(aiChatFeedbackBodySchema), postAiChatFeedbackHandler);
r.post('/chat', validateBody(aiChatBodySchema), postAiChat);

export default r;
