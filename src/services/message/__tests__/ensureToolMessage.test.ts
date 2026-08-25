import type { EnsureToolMessageInput } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';

import { MessageService } from '../index';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    message: {
      ensureToolMessage: {
        mutate: vi.fn(),
      },
    },
  },
}));

describe('MessageService.ensureToolMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards the immutable intent and abort signal and returns the minimal acknowledgement', async () => {
    const input: EnsureToolMessageInput = {
      agentId: 'agent-1',
      id: 'tool-message-1',
      parentMessageId: 'assistant-message-1',
      toolCall: {
        apiName: 'runCommand',
        arguments: '{"command":"pwd"}',
        identifier: 'lobe-local-system',
        toolCallId: 'call-1',
        type: 'builtin',
      },
    };
    const acknowledgement = { disposition: 'existing' as const, id: input.id };
    const controller = new AbortController();
    vi.mocked(lambdaClient.message.ensureToolMessage.mutate).mockResolvedValue(acknowledgement);
    const messageService = new MessageService();

    const result = await messageService.ensureToolMessage(input, { signal: controller.signal });

    expect(lambdaClient.message.ensureToolMessage.mutate).toHaveBeenCalledWith(input, {
      signal: controller.signal,
    });
    expect(result).toEqual(acknowledgement);
  });
});
