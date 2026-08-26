import { describe, expect, it, vi } from 'vitest';

import { createChatStoreToolExecutorAdapter } from './chatStoreToolExecutorAdapter';

const toolCall = {
  apiName: 'runCommand',
  arguments: '{"command":"pwd"}',
  id: 'call-1',
  identifier: 'lobe-local-system',
  type: 'builtin' as const,
};

describe('createChatStoreToolExecutorAdapter', () => {
  it('delegates to the raw tool executor exactly once without a message write', async () => {
    const internal_executeDifferentTypePlugin = vi
      .fn()
      .mockResolvedValue({ content: 'done', success: true });
    const executor = createChatStoreToolExecutorAdapter(
      () => ({ internal_executeDifferentTypePlugin }) as any,
    );
    const signal = new AbortController().signal;

    await expect(
      executor.execute({
        executionAttemptId: 'execution-1',
        messageId: 'tool-message-1',
        operationId: 'execute-operation-1',
        signal,
        stepContext: { todos: [] },
        toolCall,
      }),
    ).resolves.toEqual({ content: 'done', success: true });

    expect(internal_executeDifferentTypePlugin).toHaveBeenCalledTimes(1);
    expect(internal_executeDifferentTypePlugin).toHaveBeenCalledWith(
      'tool-message-1',
      toolCall,
      { todos: [] },
      signal,
    );
  });

  it('throws when the raw executor violates the result contract', async () => {
    const executor = createChatStoreToolExecutorAdapter(
      () => ({ internal_executeDifferentTypePlugin: vi.fn() }) as any,
    );

    await expect(
      executor.execute({
        executionAttemptId: 'execution-1',
        messageId: 'tool-message-1',
        operationId: 'execute-operation-1',
        signal: new AbortController().signal,
        toolCall,
      }),
    ).rejects.toThrow('completed without a result');
  });
});
