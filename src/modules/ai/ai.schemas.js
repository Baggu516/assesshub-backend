import { z } from 'zod';

const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(8000),
});

const aiProviderSchema = z.enum(['gemini', 'groq', 'ollama']);

export const aiChatReplyBodySchema = z.object({
  provider: aiProviderSchema,
  /** Ollama model id (e.g. gemma3:4b). Ignored for cloud providers. */
  model: z.string().trim().min(1).max(120).optional(),
  content: z.string().min(1).max(8000),
});

export const aiChatPatchBodySchema = z.object({
  title: z.string().min(1).max(200),
});

export const aiChatFeedbackBodySchema = z.object({
  messageIndex: z.number().int().min(0),
  rating: z.enum(['up', 'down']),
});

export const aiChatBodySchema = z
  .object({
    provider: aiProviderSchema,
    model: z.string().trim().min(1).max(120).optional(),
    messages: z.array(chatMessageSchema).min(1).max(24),
  })
  .superRefine((data, ctx) => {
    const { messages } = data;
    if (messages[0].role !== 'user') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'First message must be from the user',
        path: ['messages', 0, 'role'],
      });
    }
    if (messages[messages.length - 1].role !== 'user') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Last message must be from the user',
        path: ['messages', messages.length - 1, 'role'],
      });
    }
  });
