import { describe, expect, it, vi } from 'vitest';

import { createChatStoreToolCallOperationAdapter } from './chatStoreOperationAdapter';

describe('createChatStoreToolCallOperationAdapter', () => {
  it('projects lifecycle operations onto the chat operation tree with inherited context', () => {
    const operations: Record<string, any> = {};
    const store: any = {
      cancelOperation: vi.fn((id: string) => {
        operations[id].status = 'cancelled';
      }),
      completeOperation: vi.fn((id: string) => {
        operations[id].status = 'completed';
      }),
      failOperation: vi.fn((id: string) => {
        operations[id].status = 'failed';
      }),
      operations,
      startOperation: vi.fn((input: any) => {
        const operationId = `operation-${Object.keys(operations).length + 1}`;
        operations[operationId] = {
          abortController: new AbortController(),
          context: input.context,
          id: operationId,
          metadata: input.metadata,
          parentOperationId: input.parentOperationId,
          status: 'running',
          type: input.type,
        };
        return { abortController: operations[operationId].abortController, operationId };
      }),
      updateOperationMetadata: vi.fn(),
    };
    const adapter = createChatStoreToolCallOperationAdapter(() => store);

    const operation = adapter.start({
      context: { agentId: 'agent-1', messageId: 'tool-message-1', topicId: 'topic-1' },
      metadata: { toolCallId: 'call-1' },
      parentOperationId: 'root-operation',
      type: 'executeToolCall',
    });

    expect(operation).toMatchObject({
      id: 'operation-1',
      parentOperationId: 'root-operation',
      status: 'running',
      type: 'executeToolCall',
    });
    expect(store.startOperation).toHaveBeenCalledWith({
      context: { agentId: 'agent-1', messageId: 'tool-message-1', topicId: 'topic-1' },
      metadata: { toolCallId: 'call-1', tool_call_id: 'call-1' },
      parentOperationId: 'root-operation',
      type: 'executeToolCall',
    });

    adapter.complete(operation.id);
    expect(adapter.get(operation.id)?.status).toBe('completed');
  });

  it('preserves lifecycle phase details when failing an operation', () => {
    const abortController = new AbortController();
    const store: any = {
      cancelOperation: vi.fn(),
      completeOperation: vi.fn(),
      failOperation: vi.fn(),
      operations: {
        'operation-1': {
          abortController,
          id: 'operation-1',
          metadata: {},
          status: 'running',
          type: 'syncToolResult',
        },
      },
      startOperation: vi.fn(),
      updateOperationMetadata: vi.fn(),
    };
    const adapter = createChatStoreToolCallOperationAdapter(() => store);
    const error = Object.assign(new Error('result sync exhausted'), {
      code: 'RESULT_SYNC_RETRY_EXHAUSTED',
      execution: 'completed',
      phase: 'sync-result',
      retryable: true,
    });

    adapter.fail('operation-1', error);

    expect(store.failOperation).toHaveBeenCalledWith('operation-1', {
      code: 'RESULT_SYNC_RETRY_EXHAUSTED',
      details: { execution: 'completed', phase: 'sync-result', retryable: true },
      message: 'result sync exhausted',
      type: 'Error',
    });
  });
});
