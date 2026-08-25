import type { CommitToolResultInput } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';

import { MessageService } from '../index';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    message: {
      commitToolResult: {
        mutate: vi.fn(),
      },
    },
  },
}));

describe('MessageService.commitToolResult', () => {
  const input: CommitToolResultInput = {
    executionAttemptId: 'attempt-1',
    id: 'tool-message-1',
    result: {
      content: 'done',
      metadata: { toolExecutionTimeMs: 42 },
      state: { output: 'done' },
      success: true,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards the complete result and AbortSignal and returns the minimal acknowledgement', async () => {
    const acknowledgement = { disposition: 'committed' as const, id: input.id };
    const controller = new AbortController();
    vi.mocked(lambdaClient.message.commitToolResult.mutate).mockResolvedValue(acknowledgement);
    const messageService = new MessageService();

    const result = await messageService.commitToolResult(input, { signal: controller.signal });

    expect(lambdaClient.message.commitToolResult.mutate).toHaveBeenCalledWith(input, {
      signal: controller.signal,
    });
    expect(result).toEqual(acknowledgement);
  });

  it('does not swallow transport failures', async () => {
    const transportError = Object.assign(new Error('service unavailable'), { status: 503 });
    vi.mocked(lambdaClient.message.commitToolResult.mutate).mockRejectedValue(transportError);
    const messageService = new MessageService();

    await expect(messageService.commitToolResult(input)).rejects.toBe(transportError);
  });
});
