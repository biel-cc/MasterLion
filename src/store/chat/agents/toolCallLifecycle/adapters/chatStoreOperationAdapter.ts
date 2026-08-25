import { type ChatStore } from '@/store/chat/store';

import {
  type ToolCallLifecycleDependencies,
  type ToolCallOperationRecord,
} from '../ToolCallLifecycle';

type OperationPort = ToolCallLifecycleDependencies['operations'];

interface ChatStoreOperationAdapterOptions {
  onStart?: (operation: ToolCallOperationRecord) => void;
}

const toOperationError = (error: unknown) => {
  if (error instanceof Error) {
    const lifecycleError = error as Error & {
      code?: string;
      execution?: string;
      phase?: string;
      retryable?: boolean;
    };
    return {
      code: lifecycleError.code,
      details: {
        execution: lifecycleError.execution,
        phase: lifecycleError.phase,
        retryable: lifecycleError.retryable,
      },
      message: error.message,
      type: error.name || 'ToolCallLifecycleError',
    };
  }

  return {
    message: String(error),
    type: 'ToolCallLifecycleError',
  };
};

const selectOperation = (
  get: () => ChatStore,
  operationId: string,
): ToolCallOperationRecord | undefined => {
  const operation = get().operations[operationId];
  if (!operation) return undefined;

  return {
    id: operation.id,
    parentOperationId: operation.parentOperationId,
    signal: operation.abortController.signal,
    status: operation.status,
    type: operation.type as ToolCallOperationRecord['type'],
  };
};

/** Project the lifecycle state machine onto the existing Zustand operation tree. */
export const createChatStoreToolCallOperationAdapter = (
  get: () => ChatStore,
  options: ChatStoreOperationAdapterOptions = {},
): OperationPort => ({
  cancel: (operationId, reason) => get().cancelOperation(operationId, reason),
  complete: (operationId) => get().completeOperation(operationId),
  fail: (operationId, error) => get().failOperation(operationId, toOperationError(error)),
  get: (operationId) => selectOperation(get, operationId),
  start: ({ context, metadata, parentOperationId, type }) => {
    const { operationId } = get().startOperation({
      context,
      metadata: {
        ...metadata,
        tool_call_id: metadata?.toolCallId,
      },
      parentOperationId,
      type,
    });

    const operation = selectOperation(get, operationId);
    if (!operation) throw new Error(`Operation was not created: ${operationId}`);
    options.onStart?.(operation);
    return operation;
  },
  updateMetadata: (operationId, metadata) => get().updateOperationMetadata(operationId, metadata),
});
