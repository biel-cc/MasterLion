import { z } from 'zod';

const BuiltinToolResultSchema = z
  .object({
    content: z.string().optional(),
    error: z
      .object({
        body: z.any().optional(),
        message: z.string(),
        type: z.string(),
      })
      .strict()
      .optional(),
    metadata: z.record(z.string(), z.any()).optional(),
    state: z.any().optional(),
    stop: z.boolean().optional(),
    success: z.boolean(),
  })
  .strict();

export const EnsureToolMessageInputSchema = z
  .object({
    agentId: z.string().min(1),
    groupId: z.string().nullable().optional(),
    id: z.string().min(1),
    mode: z.enum(['confirm-existing', 'create-or-confirm']).optional(),
    parentMessageId: z.string().min(1),
    threadId: z.string().nullable().optional(),
    toolCall: z
      .object({
        apiName: z.string().min(1),
        arguments: z.string(),
        executor: z.enum(['client', 'server']).optional(),
        identifier: z.string().min(1),
        intervention: z
          .object({
            rejectedReason: z.string().optional(),
            status: z.enum(['pending', 'approved', 'rejected', 'aborted', 'none']).optional(),
          })
          .strict()
          .optional(),
        result_msg_id: z.string().optional(),
        source: z.enum(['builtin', 'client', 'mcp', 'composio', 'lobehubSkill']).optional(),
        thoughtSignature: z.string().optional(),
        toolCallId: z.string().min(1),
        type: z.enum(['builtin', 'default', 'markdown', 'mcp', 'standalone']),
      })
      .strict(),
    topicId: z.string().nullable().optional(),
  })
  .strict();

export type EnsureToolMessageInput = z.infer<typeof EnsureToolMessageInputSchema>;

export interface EnsureToolMessageResult {
  disposition: 'created' | 'existing';
  id: string;
}

export const CommitToolResultInputSchema = z
  .object({
    executionAttemptId: z.string().min(1),
    id: z.string().min(1),
    result: BuiltinToolResultSchema,
  })
  .strict();

export type CommitToolResultInput = z.infer<typeof CommitToolResultInputSchema>;

export interface CommitToolResultResult {
  disposition: 'committed' | 'existing';
  id: string;
}

/** Server-owned metadata created with the immutable tool-message intent. */
export interface ToolMessageIntentLifecycleMetadata {
  intentFingerprint: string;
}

/** Server-owned metadata written atomically with a local tool result. */
export interface ToolResultLifecycleMetadata {
  executionAttemptId: string;
  intentFingerprint: string;
  resultFingerprint: string;
}
