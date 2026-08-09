import { Router } from 'express';
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import {
  requireAiPlan,
  requireAiAssessmentCreate,
} from '../../middleware/plan.middleware.js';
import { aiLimiter } from '../../middleware/rateLimit.middleware.js';
import { validateBody } from '../../middleware/validate.middleware.js';
import { PERMISSION_KEYS } from '../../constants/permissions.js';
import {
  aiChatBodySchema,
  aiChatReplyBodySchema,
  aiChatPatchBodySchema,
  aiChatFeedbackBodySchema,
  aiGenerateQuestionsBodySchema,
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
  postAiGenerateQuestions,
} from './ai.controller.js';

const r = Router();

r.use(tenantMiddleware, requireAuth, aiLimiter);

/** Provider list — any signed-in tenant user (used by dashboard chat and AI create). */
r.get('/providers', getAiProviders);

r.post(
  '/generate-questions',
  requireAiAssessmentCreate,
  requirePermission(PERMISSION_KEYS.ASSESSMENT_CREATE),
  validateBody(aiGenerateQuestionsBodySchema),
  postAiGenerateQuestions
);

/** Dashboard AI chat + knowledge status require AI dashboard entitlement. */
r.get('/knowledge-status', requireAiPlan, getAiKnowledgeStatus);
r.get('/chats', requireAiPlan, listAiChatsHandler);
r.post('/chats', requireAiPlan, createAiChatHandler);
r.get('/chats/:id', requireAiPlan, getAiChatHandler);
r.patch('/chats/:id', requireAiPlan, validateBody(aiChatPatchBodySchema), patchAiChatHandler);
r.delete('/chats/:id', requireAiPlan, deleteAiChatHandler);
r.post(
  '/chats/:id/reply',
  requireAiPlan,
  validateBody(aiChatReplyBodySchema),
  postAiChatReplyHandler
);
r.post(
  '/chats/:id/feedback',
  requireAiPlan,
  validateBody(aiChatFeedbackBodySchema),
  postAiChatFeedbackHandler
);
r.post('/chat', requireAiPlan, validateBody(aiChatBodySchema), postAiChat);

export default r;
