import { z } from 'zod';

const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(8000),
});

export const aiChatReplyBodySchema = z.object({
  provider: z.enum(['gemini', 'groq']),
  content: z.string().min(1).max(8000),
});

export const aiChatPatchBodySchema = z.object({
  title: z.string().min(1).max(200),
});

export const aiChatBodySchema = z
  .object({
    provider: z.enum(['gemini', 'groq']),
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
