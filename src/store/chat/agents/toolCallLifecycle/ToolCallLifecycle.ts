import type { BuiltinToolResult, ChatToolPayload, ConversationContext } from '@lobechat/types';
import { nanoid } from 'nanoid';

export type ToolCallOperationStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';
export type ToolCallOperationType =
  | 'toolCalling'
  | 'createToolMessage'
  | 'executeToolCall'
  | 'syncToolResult';

export interface ToolCallOperationRecord {
  id: string;
  parentOperationId?: string;
  signal: AbortSignal;
  status: ToolCallOperationStatus;
  type: ToolCallOperationType;
}

export interface ToolCallCommand {
  context: ConversationContext;
  message:
    | { kind: 'create'; messageId: string; parentMessageId: string }
    | { kind: 'existing'; messageId: string; parentMessageId: string };
  parentOperationId?: string;
  signal?: AbortSignal;
  stepContext?: unknown;
  toolCall: ChatToolPayload;
}

export interface ToolCallReceipt {
  executionAttemptId: string;
  executionTimeMs: number;
  messageId: string;
  result: BuiltinToolResult;
}

export type ToolCallExecutionState = 'not-started' | 'completed' | 'unknown';
export type ToolCallLifecyclePhase =
  | 'prepare-message'
  | 'execute-tool'
  | 'sync-result'
  | 'invariant';

export class ToolCallLifecycleError extends Error {
  readonly code: string;
  readonly execution: ToolCallExecutionState;
  readonly phase: ToolCallLifecyclePhase;
  readonly retryable: boolean;

  constructor(input: {
    cause?: unknown;
    code: string;
    execution: ToolCallExecutionState;
    message: string;
    phase: ToolCallLifecyclePhase;
    retryable: boolean;
  }) {
    super(input.message, { cause: input.cause });
    this.name = 'ToolCallLifecycleError';
    this.code = input.code;
    this.execution = input.execution;
    this.phase = input.phase;
    this.retryable = input.retryable;
  }
}

export interface ToolCallLifecycleDependencies {
  executor: {
    execute: (input: {
      executionAttemptId: string;
      messageId: string;
      operationId: string;
      signal: AbortSignal;
      stepContext?: unknown;
      toolCall: ChatToolPayload;
    }) => Promise<BuiltinToolResult>;
  };
  ids?: { createExecutionAttemptId: () => string };
  messages: {
    commitResult: (input: {
      executionAttemptId: string;
      messageId: string;
      operationId: string;
      result: BuiltinToolResult;
      signal: AbortSignal;
      toolCall: ChatToolPayload;
    }) => Promise<void>;
    ensurePrepared: (input: {
      context: ToolCallCommand['context'];
      messageId: string;
      operationId: string;
      parentMessageId: string;
      projectLocally: boolean;
      signal: AbortSignal;
      toolCall: ChatToolPayload;
    }) => Promise<{ disposition: 'created' | 'existing'; messageId: string }>;
  };
  operations: {
    cancel: (operationId: string, reason: string) => void;
    complete: (operationId: string) => void;
    fail: (operationId: string, error: unknown) => void;
    get: (operationId: string) => ToolCallOperationRecord | undefined;
    start: (input: {
      context?: ToolCallCommand['context'] & { messageId?: string };
      metadata?: Record<string, unknown>;
      parentOperationId?: string;
      type: ToolCallOperationType;
    }) => ToolCallOperationRecord;
    updateMetadata: (operationId: string, metadata: Record<string, unknown>) => void;
  };
  retry?: ToolCallRetryPolicy;
}

export interface ToolCallRetryPolicy {
  attemptTimeoutMs: number;
  clock: {
    now: () => number;
    sleep: (delayMs: number, signal: AbortSignal) => Promise<void>;
  };
  delaysMs: number[];
  isRetryable: (error: unknown) => boolean;
  jitterRatio: number;
  random: () => number;
  totalTimeoutMs: number;
}

const jitterDelay = (delayMs: number, jitterRatio: number, random: () => number) =>
  Math.max(0, Math.round(delayMs * (1 + (random() * 2 - 1) * jitterRatio)));

const createAbortError = (reason?: unknown) =>
  Object.assign(new Error(typeof reason === 'string' ? reason : 'Tool call request cancelled'), {
    name: 'AbortError',
  });

const normalizeAbortReason = (reason?: unknown) =>
  reason instanceof Error ? reason : createAbortError(reason);

const createToolExecutionError = (error: BuiltinToolResult['error']) => {
  const message =
    typeof error === 'string'
      ? error
      : error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : 'Tool execution failed';

  return Object.assign(new Error(message), { name: 'ToolExecutionError' });
};

// A renderer can dispatch the same approved message twice before the first result commit reaches
// the server (for example, a double click). Serialize that message locally so two lifecycle
// instances cannot both cross the durable prepare barrier and execute the side effect. Durable
// recovery across renderer/Main restarts still requires the P2 local journal.
const activeToolMessageRuns = new Set<string>();

const activeRunKey = (command: ToolCallCommand) =>
  JSON.stringify([
    command.context.agentId,
    command.context.groupId ?? null,
    command.context.topicId ?? null,
    command.context.threadId ?? null,
    command.message.messageId,
  ]);

const throwIfAborted = (...signals: AbortSignal[]) => {
  const aborted = signals.find((signal) => signal.aborted);
  if (aborted) throw normalizeAbortReason(aborted.reason);
};

const runUntilAborted = async <T>(signals: AbortSignal[], task: () => Promise<T>): Promise<T> => {
  throwIfAborted(...signals);

  let removeAbortListeners = () => {};
  const aborted = new Promise<never>((_, reject) => {
    const listeners = signals.map((signal) => {
      const onAbort = () => reject(normalizeAbortReason(signal.reason));
      signal.addEventListener('abort', onAbort, { once: true });
      return [signal, onAbort] as const;
    });
    const alreadyAborted = signals.find((signal) => signal.aborted);
    if (alreadyAborted) reject(normalizeAbortReason(alreadyAborted.reason));
    removeAbortListeners = () => {
      for (const [signal, listener] of listeners) signal.removeEventListener('abort', listener);
    };
  });

  try {
    return await Promise.race([task(), aborted]);
  } finally {
    removeAbortListeners();
  }
};

const runWithAttemptTimeout = async <T>(input: {
  parentSignal: AbortSignal;
  task: (signal: AbortSignal) => Promise<T>;
  timeoutMs: number;
}): Promise<T> => {
  const attemptController = new AbortController();
  const abortFromParent = () =>
    attemptController.abort(normalizeAbortReason(input.parentSignal.reason));
  if (input.parentSignal.aborted) abortFromParent();
  else input.parentSignal.addEventListener('abort', abortFromParent, { once: true });

  const timeoutError = Object.assign(new Error('Tool call request timed out'), {
    code: 'ETIMEDOUT',
    name: 'TimeoutError',
  });
  const timeout = setTimeout(() => attemptController.abort(timeoutError), input.timeoutMs);
  const aborted = new Promise<never>((_, reject) => {
    if (attemptController.signal.aborted) {
      reject(attemptController.signal.reason ?? createAbortError());
      return;
    }
    attemptController.signal.addEventListener(
      'abort',
      () => reject(attemptController.signal.reason ?? createAbortError()),
      { once: true },
    );
  });

  try {
    return await Promise.race([input.task(attemptController.signal), aborted]);
  } finally {
    clearTimeout(timeout);
    input.parentSignal.removeEventListener('abort', abortFromParent);
  }
};

interface RetriedPhaseInput<T> {
  exhaustedCode: string;
  failedCode: string;
  fallbackMessage: string;
  operation: ToolCallOperationRecord;
  phase: Extract<ToolCallLifecyclePhase, 'prepare-message' | 'sync-result'>;
  run: (signal: AbortSignal) => Promise<T>;
}

export class ToolCallLifecycle {
  private readonly dependencies: ToolCallLifecycleDependencies;

  constructor(dependencies: ToolCallLifecycleDependencies) {
    this.dependencies = dependencies;
  }

  private async runRetriedPhase<T>({
    exhaustedCode,
    failedCode,
    fallbackMessage,
    operation,
    phase,
    run,
  }: RetriedPhaseInput<T>): Promise<T> {
    const { operations, retry } = this.dependencies;
    const execution = phase === 'prepare-message' ? 'not-started' : 'completed';

    if (!retry) {
      try {
        return await run(operation.signal);
      } catch (error) {
        if (operation.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
          throw error;
        }

        throw new ToolCallLifecycleError({
          cause: error,
          code: failedCode,
          execution,
          message: error instanceof Error ? error.message : fallbackMessage,
          phase,
          retryable: false,
        });
      }
    }

    const startedAt = retry.clock.now();
    let lastError: unknown = Object.assign(
      new Error(`${fallbackMessage}: retry budget exhausted`),
      {
        code: 'ETIMEDOUT',
      },
    );

    for (const [attemptIndex, baseDelayMs] of retry.delaysMs.entries()) {
      const delayMs =
        attemptIndex === 0 ? 0 : jitterDelay(baseDelayMs, retry.jitterRatio, retry.random);
      let remainingMs = retry.totalTimeoutMs - (retry.clock.now() - startedAt);

      if (remainingMs <= delayMs) break;
      if (delayMs > 0) await retry.clock.sleep(delayMs, operation.signal);

      remainingMs = retry.totalTimeoutMs - (retry.clock.now() - startedAt);
      if (remainingMs <= 0) break;

      operations.updateMetadata(operation.id, {
        attempt: attemptIndex + 1,
        maxAttempts: retry.delaysMs.length,
        phase,
      });

      try {
        return await runWithAttemptTimeout({
          parentSignal: operation.signal,
          task: run,
          timeoutMs: Math.min(retry.attemptTimeoutMs, remainingMs),
        });
      } catch (error) {
        if (operation.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
          throw error;
        }

        lastError = error;
        const retryable = retry.isRetryable(error);
        if (!retryable) {
          throw new ToolCallLifecycleError({
            cause: error,
            code: failedCode,
            execution,
            message: error instanceof Error ? error.message : fallbackMessage,
            phase,
            retryable: false,
          });
        }

        if (attemptIndex + 1 >= retry.delaysMs.length) break;
      }
    }

    throw new ToolCallLifecycleError({
      cause: lastError,
      code: exhaustedCode,
      execution,
      message: lastError instanceof Error ? lastError.message : fallbackMessage,
      phase,
      retryable: true,
    });
  }

  async run(command: ToolCallCommand): Promise<ToolCallReceipt> {
    const { executor, ids, messages, operations } = this.dependencies;
    const ownedOperationIds: string[] = [];
    const startOwnedOperation = (
      type: ToolCallOperationType,
      parentOperationId?: string,
      metadata?: Record<string, unknown>,
      operationContext?: ToolCallCommand['context'] & { messageId?: string },
    ) => {
      const operation = operations.start({
        context: operationContext,
        metadata,
        parentOperationId,
        type,
      });
      ownedOperationIds.push(operation.id);
      return operation;
    };

    const toolOperation = startOwnedOperation(
      'toolCalling',
      command.parentOperationId,
      {
        apiName: command.toolCall.apiName,
        identifier: command.toolCall.identifier,
        toolCallId: command.toolCall.id,
      },
      command.context,
    );
    const externalSignals = command.signal ? [command.signal] : [];
    const cancelFromExternalSignal = () => {
      operations.cancel(
        toolOperation.id,
        command.signal?.reason instanceof Error
          ? command.signal.reason.message
          : 'Tool call batch cancelled',
      );
    };
    if (command.signal?.aborted) cancelFromExternalSignal();
    else command.signal?.addEventListener('abort', cancelFromExternalSignal, { once: true });
    const runKey = activeRunKey(command);
    let ownsRunReservation = false;
    let executionTask: Promise<BuiltinToolResult> | undefined;
    let executionTaskSettled = true;

    try {
      if (activeToolMessageRuns.has(runKey)) {
        throw new ToolCallLifecycleError({
          code: 'TOOL_CALL_ALREADY_RUNNING',
          execution: 'not-started',
          message: `Tool message ${command.message.messageId} is already executing`,
          phase: 'invariant',
          retryable: false,
        });
      }
      activeToolMessageRuns.add(runKey);
      ownsRunReservation = true;

      throwIfAborted(...externalSignals, toolOperation.signal);
      const messageId = command.message.messageId;

      const parentMessageId = command.message.parentMessageId;
      const prepareOperation = startOwnedOperation(
        'createToolMessage',
        toolOperation.id,
        { toolCallId: command.toolCall.id },
        command.context,
      );
      const ensurePrepared = (signal: AbortSignal) =>
        messages.ensurePrepared({
          context: command.context,
          messageId,
          operationId: prepareOperation.id,
          parentMessageId,
          projectLocally: command.message.kind === 'create',
          signal,
          toolCall: command.toolCall,
        });

      const prepared = await this.runRetriedPhase({
        exhaustedCode: 'PREPARE_RETRY_EXHAUSTED',
        failedCode: 'PREPARE_FAILED',
        fallbackMessage: 'Failed to prepare tool message',
        operation: prepareOperation,
        phase: 'prepare-message',
        run: ensurePrepared,
      });
      if (prepared.messageId !== messageId) {
        throw new ToolCallLifecycleError({
          code: 'PREPARED_MESSAGE_ID_MISMATCH',
          execution: 'not-started',
          message: `Prepared tool message ${prepared.messageId} did not match ${messageId}`,
          phase: 'invariant',
          retryable: false,
        });
      }
      throwIfAborted(...externalSignals, toolOperation.signal, prepareOperation.signal);
      operations.complete(prepareOperation.id);

      throwIfAborted(...externalSignals, toolOperation.signal);
      const executionAttemptId = ids?.createExecutionAttemptId() ?? `tool_execution_${nanoid()}`;
      const executeOperation = startOwnedOperation(
        'executeToolCall',
        toolOperation.id,
        {
          executionAttemptId,
          toolCallId: command.toolCall.id,
        },
        { ...command.context, messageId },
      );
      const executionStartedAt = performance.now();
      let result: BuiltinToolResult;
      try {
        result = await runUntilAborted(
          [...externalSignals, toolOperation.signal, executeOperation.signal],
          () => {
            executionTaskSettled = false;
            executionTask = Promise.resolve().then(() =>
              executor.execute({
                executionAttemptId,
                messageId,
                operationId: executeOperation.id,
                signal: executeOperation.signal,
                stepContext: command.stepContext,
                toolCall: command.toolCall,
              }),
            );
            void executionTask.then(
              () => {
                executionTaskSettled = true;
              },
              () => {
                executionTaskSettled = true;
              },
            );
            return executionTask;
          },
        );
      } catch (error) {
        if (
          executeOperation.signal.aborted ||
          (error instanceof Error && error.name === 'AbortError')
        ) {
          throw error;
        }

        throw new ToolCallLifecycleError({
          cause: error,
          code: 'TOOL_EXECUTION_FAILED',
          execution: 'unknown',
          message: error instanceof Error ? error.message : 'Local tool execution failed',
          phase: 'execute-tool',
          retryable: false,
        });
      }
      throwIfAborted(...externalSignals, toolOperation.signal, executeOperation.signal);
      const executionTimeMs = Math.round(performance.now() - executionStartedAt);
      operations.complete(executeOperation.id);

      const syncOperation = startOwnedOperation(
        'syncToolResult',
        toolOperation.id,
        {
          executionAttemptId,
          toolCallId: command.toolCall.id,
        },
        { ...command.context, messageId },
      );
      const commitResult = (signal: AbortSignal) =>
        messages.commitResult({
          executionAttemptId,
          messageId,
          operationId: syncOperation.id,
          result,
          signal,
          toolCall: command.toolCall,
        });

      await this.runRetriedPhase({
        exhaustedCode: 'RESULT_SYNC_RETRY_EXHAUSTED',
        failedCode: 'RESULT_SYNC_FAILED',
        fallbackMessage: 'Failed to synchronize tool result',
        operation: syncOperation,
        phase: 'sync-result',
        run: commitResult,
      });
      throwIfAborted(...externalSignals, toolOperation.signal, syncOperation.signal);
      operations.complete(syncOperation.id);

      if (result.success) {
        operations.complete(toolOperation.id);
      } else {
        operations.fail(toolOperation.id, createToolExecutionError(result.error));
      }

      return { executionAttemptId, executionTimeMs, messageId, result };
    } catch (error) {
      const cancelled =
        command.signal?.aborted ||
        (error instanceof Error && error.name === 'AbortError') ||
        ownedOperationIds.some((operationId) => operations.get(operationId)?.signal.aborted);
      for (const operationId of ownedOperationIds.toReversed()) {
        if (operations.get(operationId)?.status === 'running') {
          if (cancelled) {
            operations.cancel(
              operationId,
              error instanceof Error ? error.message : 'Tool call cancelled',
            );
          } else {
            operations.fail(operationId, error);
          }
        }
      }
      throw error;
    } finally {
      if (ownsRunReservation) {
        if (executionTask && !executionTaskSettled) {
          // Some local tools cannot be interrupted once their native side effect has started. Keep
          // the message reserved until that underlying promise settles, even though the lifecycle
          // can already cancel its UI operations. Otherwise an immediate retry can execute the same
          // side effect concurrently.
          void executionTask.then(
            () => activeToolMessageRuns.delete(runKey),
            () => activeToolMessageRuns.delete(runKey),
          );
        } else {
          activeToolMessageRuns.delete(runKey);
        }
      }
      command.signal?.removeEventListener('abort', cancelFromExternalSignal);
    }
  }
}
