import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ToolCallLifecycle,
  type ToolCallLifecycleDependencies,
  type ToolCallOperationRecord,
} from './ToolCallLifecycle';

const createHarness = () => {
  const calls: string[] = [];
  const operations = new Map<string, ToolCallOperationRecord>();
  let operationSequence = 0;

  const dependencies: ToolCallLifecycleDependencies = {
    executor: {
      execute: async () => {
        calls.push('execute');
        return { content: 'done', success: true };
      },
    },
    messages: {
      commitResult: async () => {
        calls.push('commit');
      },
      ensurePrepared: async ({ messageId }) => {
        calls.push('ensure');
        return { disposition: 'created', messageId };
      },
    },
    operations: {
      cancel: (operationId) => {
        operations.get(operationId)!.status = 'cancelled';
      },
      complete: (operationId) => {
        operations.get(operationId)!.status = 'completed';
      },
      fail: (operationId) => {
        operations.get(operationId)!.status = 'failed';
      },
      get: (operationId) => operations.get(operationId),
      start: ({ parentOperationId, type }) => {
        const id = `operation-${++operationSequence}`;
        const record: ToolCallOperationRecord = {
          id,
          parentOperationId,
          signal: new AbortController().signal,
          status: 'running',
          type,
        };
        operations.set(id, record);
        return record;
      },
      updateMetadata: () => {},
    },
  };

  return { calls, dependencies, operations };
};

describe('ToolCallLifecycle', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('prepares the tool message before one local execution and result commit', async () => {
    const { calls, dependencies, operations } = createHarness();
    const lifecycle = new ToolCallLifecycle(dependencies);

    const receipt = await lifecycle.run({
      context: { agentId: 'agent-1', topicId: 'topic-1' },
      message: {
        kind: 'create',
        messageId: 'tool-message-1',
        parentMessageId: 'assistant-message-1',
      },
      parentOperationId: 'root-operation',
      toolCall: {
        apiName: 'runCommand',
        arguments: '{"command":"pwd"}',
        id: 'tool-call-1',
        identifier: 'local-system',
        type: 'builtin',
      },
    });

    expect(calls).toEqual(['ensure', 'execute', 'commit']);
    expect(receipt).toMatchObject({
      messageId: 'tool-message-1',
      result: { content: 'done', success: true },
    });
    expect([...operations.values()].every(({ status }) => status === 'completed')).toBe(true);
  });

  it('revalidates an existing message before resuming local execution', async () => {
    const { calls, dependencies } = createHarness();
    let projectedLocally: boolean | undefined;
    dependencies.messages.ensurePrepared = async ({ messageId, projectLocally }) => {
      calls.push('ensure');
      projectedLocally = projectLocally;
      return { disposition: 'existing', messageId };
    };

    await new ToolCallLifecycle(dependencies).run({
      context: { agentId: 'agent-1', topicId: 'topic-1' },
      message: {
        kind: 'existing',
        messageId: 'tool-message-existing',
        parentMessageId: 'assistant-message-1',
      },
      toolCall: {
        apiName: 'runCommand',
        arguments: '{"command":"pwd"}',
        id: 'tool-call-existing',
        identifier: 'local-system',
        intervention: { status: 'approved' },
        type: 'builtin',
      },
    });

    expect(calls).toEqual(['ensure', 'execute', 'commit']);
    expect(projectedLocally).toBe(false);
  });

  it('allows only one in-flight lifecycle for the same durable tool message', async () => {
    const { calls, dependencies, operations } = createHarness();
    let releasePrepare!: () => void;
    const prepareGate = new Promise<void>((resolve) => {
      releasePrepare = resolve;
    });
    dependencies.messages.ensurePrepared = async ({ messageId }) => {
      calls.push('ensure');
      await prepareGate;
      return { disposition: 'existing', messageId };
    };
    const lifecycle = new ToolCallLifecycle(dependencies);
    const command = {
      context: { agentId: 'agent-1', topicId: 'topic-1' },
      message: {
        kind: 'existing' as const,
        messageId: 'tool-message-existing',
        parentMessageId: 'assistant-message-1',
      },
      toolCall: {
        apiName: 'runCommand',
        arguments: '{"command":"pwd"}',
        id: 'tool-call-existing',
        identifier: 'local-system',
        intervention: { status: 'approved' as const },
        type: 'builtin' as const,
      },
    };

    const firstRun = lifecycle.run(command);
    await vi.waitFor(() => expect(calls).toEqual(['ensure']));
    await expect(lifecycle.run(command)).rejects.toMatchObject({
      code: 'TOOL_CALL_ALREADY_RUNNING',
      execution: 'not-started',
    });

    expect(calls).toEqual(['ensure']);
    releasePrepare();
    await firstRun;

    expect(calls).toEqual(['ensure', 'execute', 'commit']);
    expect([...operations.values()].every(({ status }) => status !== 'running')).toBe(true);
  });

  it('does not execute an existing message when durable revalidation fails', async () => {
    const { calls, dependencies, operations } = createHarness();
    dependencies.messages.ensurePrepared = async () => {
      calls.push('ensure');
      throw new Error('existing message could not be acknowledged');
    };

    await expect(
      new ToolCallLifecycle(dependencies).run({
        context: { agentId: 'agent-1', topicId: 'topic-1' },
        message: {
          kind: 'existing',
          messageId: 'tool-message-existing',
          parentMessageId: 'assistant-message-1',
        },
        toolCall: {
          apiName: 'runCommand',
          arguments: '{"command":"pwd"}',
          id: 'tool-call-existing',
          identifier: 'local-system',
          intervention: { status: 'approved' },
          type: 'builtin',
        },
      }),
    ).rejects.toMatchObject({ code: 'PREPARE_FAILED', execution: 'not-started' });

    expect(calls).toEqual(['ensure']);
    expect([...operations.values()].every(({ status }) => status !== 'running')).toBe(true);
  });

  it('retries transient prepare failures before starting the local tool once', async () => {
    const { calls, dependencies } = createHarness();
    let prepareAttempt = 0;
    const slept: number[] = [];

    dependencies.messages.ensurePrepared = async ({ messageId }) => {
      calls.push('ensure');
      prepareAttempt += 1;
      if (prepareAttempt < 3) throw new Error('temporary gateway failure');
      return { disposition: 'existing', messageId };
    };
    dependencies.retry = {
      attemptTimeoutMs: 10_000,
      clock: {
        now: () => 0,
        sleep: async (delayMs) => {
          slept.push(delayMs);
        },
      },
      delaysMs: [0, 3000, 5000, 8000, 15_000],
      isRetryable: () => true,
      jitterRatio: 0,
      random: () => 0.5,
      totalTimeoutMs: 45_000,
    };

    const lifecycle = new ToolCallLifecycle(dependencies);
    await lifecycle.run({
      context: { agentId: 'agent-1', topicId: 'topic-1' },
      message: {
        kind: 'create',
        messageId: 'tool-message-1',
        parentMessageId: 'assistant-message-1',
      },
      toolCall: {
        apiName: 'runCommand',
        arguments: '{"command":"pwd"}',
        id: 'tool-call-1',
        identifier: 'local-system',
        type: 'builtin',
      },
    });

    expect(calls).toEqual(['ensure', 'ensure', 'ensure', 'execute', 'commit']);
    expect(slept).toEqual([3000, 5000]);
  });

  it('fails before execution when prepare retries are exhausted', async () => {
    const { calls, dependencies, operations } = createHarness();
    dependencies.messages.ensurePrepared = async () => {
      calls.push('ensure');
      throw new Error('gateway unavailable');
    };
    dependencies.retry = {
      attemptTimeoutMs: 10_000,
      clock: { now: () => 0, sleep: async () => {} },
      delaysMs: [0, 3000, 5000],
      isRetryable: () => true,
      jitterRatio: 0,
      random: () => 0.5,
      totalTimeoutMs: 45_000,
    };

    const lifecycle = new ToolCallLifecycle(dependencies);
    const promise = lifecycle.run({
      context: { agentId: 'agent-1', topicId: 'topic-1' },
      message: {
        kind: 'create',
        messageId: 'tool-message-1',
        parentMessageId: 'assistant-message-1',
      },
      toolCall: {
        apiName: 'runCommand',
        arguments: '{"command":"pwd"}',
        id: 'tool-call-1',
        identifier: 'local-system',
        type: 'builtin',
      },
    });

    await expect(promise).rejects.toMatchObject({
      code: 'PREPARE_RETRY_EXHAUSTED',
      execution: 'not-started',
      phase: 'prepare-message',
    });
    expect(calls).toEqual(['ensure', 'ensure', 'ensure']);
    expect([...operations.values()].every(({ status }) => status === 'failed')).toBe(true);
  });

  it('retries result synchronization without executing the local tool again', async () => {
    const { calls, dependencies } = createHarness();
    let commitAttempt = 0;
    const slept: number[] = [];
    dependencies.messages.commitResult = async () => {
      calls.push('commit');
      commitAttempt += 1;
      if (commitAttempt < 3) throw new Error('result gateway unavailable');
    };
    dependencies.retry = {
      attemptTimeoutMs: 10_000,
      clock: {
        now: () => 0,
        sleep: async (delayMs) => {
          slept.push(delayMs);
        },
      },
      delaysMs: [0, 3000, 5000],
      isRetryable: () => true,
      jitterRatio: 0,
      random: () => 0.5,
      totalTimeoutMs: 45_000,
    };

    const lifecycle = new ToolCallLifecycle(dependencies);
    await lifecycle.run({
      context: { agentId: 'agent-1', topicId: 'topic-1' },
      message: {
        kind: 'create',
        messageId: 'tool-message-1',
        parentMessageId: 'assistant-message-1',
      },
      toolCall: {
        apiName: 'runCommand',
        arguments: '{"command":"pwd"}',
        id: 'tool-call-1',
        identifier: 'local-system',
        type: 'builtin',
      },
    });

    expect(calls).toEqual(['ensure', 'execute', 'commit', 'commit', 'commit']);
    expect(slept).toEqual([3000, 5000]);
  });

  it('cancels prepare backoff without starting the local tool', async () => {
    const { calls, dependencies, operations } = createHarness();
    dependencies.messages.ensurePrepared = async () => {
      calls.push('ensure');
      throw new Error('temporary gateway failure');
    };
    dependencies.retry = {
      attemptTimeoutMs: 10_000,
      clock: {
        now: () => 0,
        sleep: async () => {
          throw Object.assign(new Error('cancelled by user'), { name: 'AbortError' });
        },
      },
      delaysMs: [0, 3000, 5000],
      isRetryable: () => true,
      jitterRatio: 0,
      random: () => 0.5,
      totalTimeoutMs: 45_000,
    };

    const lifecycle = new ToolCallLifecycle(dependencies);
    await expect(
      lifecycle.run({
        context: { agentId: 'agent-1', topicId: 'topic-1' },
        message: {
          kind: 'create',
          messageId: 'tool-message-1',
          parentMessageId: 'assistant-message-1',
        },
        toolCall: {
          apiName: 'runCommand',
          arguments: '{"command":"pwd"}',
          id: 'tool-call-1',
          identifier: 'local-system',
          type: 'builtin',
        },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(calls).toEqual(['ensure']);
    expect([...operations.values()].every(({ status }) => status === 'cancelled')).toBe(true);
  });

  it('bounds an individual prepare request with the attempt timeout', async () => {
    vi.useFakeTimers();
    const { calls, dependencies } = createHarness();
    dependencies.messages.ensurePrepared = async ({ signal }) => {
      calls.push('ensure');
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    };
    dependencies.retry = {
      attemptTimeoutMs: 100,
      clock: { now: Date.now, sleep: async () => {} },
      delaysMs: [0],
      isRetryable: () => true,
      jitterRatio: 0,
      random: () => 0.5,
      totalTimeoutMs: 1000,
    };

    const lifecycle = new ToolCallLifecycle(dependencies);
    const promise = lifecycle.run({
      context: { agentId: 'agent-1', topicId: 'topic-1' },
      message: {
        kind: 'create',
        messageId: 'tool-message-1',
        parentMessageId: 'assistant-message-1',
      },
      toolCall: {
        apiName: 'runCommand',
        arguments: '{"command":"pwd"}',
        id: 'tool-call-1',
        identifier: 'local-system',
        type: 'builtin',
      },
    });

    const rejection = expect(promise).rejects.toMatchObject({
      code: 'PREPARE_RETRY_EXHAUSTED',
      execution: 'not-started',
    });
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    expect(calls).toEqual(['ensure']);
  });

  it('uses the remaining total budget when it is shorter than an attempt timeout', async () => {
    vi.useFakeTimers();
    const { calls, dependencies } = createHarness();
    dependencies.messages.ensurePrepared = async ({ signal }) => {
      calls.push('ensure');
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    };
    dependencies.retry = {
      attemptTimeoutMs: 1000,
      clock: { now: Date.now, sleep: async () => {} },
      delaysMs: [0],
      isRetryable: () => true,
      jitterRatio: 0,
      random: () => 0.5,
      totalTimeoutMs: 50,
    };

    const promise = new ToolCallLifecycle(dependencies).run({
      context: { agentId: 'agent-1', topicId: 'topic-1' },
      message: {
        kind: 'create',
        messageId: 'tool-message-1',
        parentMessageId: 'assistant-message-1',
      },
      toolCall: {
        apiName: 'runCommand',
        arguments: '{"command":"pwd"}',
        id: 'tool-call-1',
        identifier: 'local-system',
        type: 'builtin',
      },
    });

    const rejection = expect(promise).rejects.toMatchObject({
      code: 'PREPARE_RETRY_EXHAUSTED',
      execution: 'not-started',
    });
    await vi.advanceTimersByTimeAsync(49);
    expect(calls).toEqual(['ensure']);
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
  });

  it('classifies a thrown local executor error and fails every owned running operation', async () => {
    const { dependencies, operations } = createHarness();
    dependencies.executor.execute = async () => {
      throw new Error('renderer process lost the tool worker');
    };

    await expect(
      new ToolCallLifecycle(dependencies).run({
        context: { agentId: 'agent-1', topicId: 'topic-1' },
        message: {
          kind: 'create',
          messageId: 'tool-message-1',
          parentMessageId: 'assistant-message-1',
        },
        toolCall: {
          apiName: 'runCommand',
          arguments: '{"command":"pwd"}',
          id: 'tool-call-1',
          identifier: 'local-system',
          type: 'builtin',
        },
      }),
    ).rejects.toMatchObject({
      code: 'TOOL_EXECUTION_FAILED',
      execution: 'unknown',
      phase: 'execute-tool',
    });
    expect([...operations.values()].map(({ status }) => status)).toEqual([
      'failed',
      'completed',
      'failed',
    ]);
  });

  it('cancels promptly but reserves the message until a non-cooperative executor settles', async () => {
    const { calls, dependencies, operations } = createHarness();
    const batchController = new AbortController();
    let executionCount = 0;
    let settleFirstExecution!: (result: { content: string; success: true }) => void;
    dependencies.executor.execute = async () => {
      calls.push('execute');
      executionCount += 1;
      if (executionCount === 1) {
        return new Promise((resolve) => {
          settleFirstExecution = resolve;
        });
      }
      return { content: 'done', success: true };
    };

    const lifecycle = new ToolCallLifecycle(dependencies);
    const command = {
      context: { agentId: 'agent-1', topicId: 'topic-1' },
      message: {
        kind: 'create' as const,
        messageId: 'tool-message-cancelled-execution',
        parentMessageId: 'assistant-message-1',
      },
      signal: batchController.signal,
      toolCall: {
        apiName: 'runCommand',
        arguments: '{"command":"pwd"}',
        id: 'tool-call-cancelled-execution',
        identifier: 'local-system',
        type: 'builtin' as const,
      },
    };
    const promise = lifecycle.run(command);

    await vi.waitFor(() => expect(calls).toEqual(['ensure', 'execute']));
    batchController.abort(new Error('sibling lifecycle failed'));

    await expect(promise).rejects.toThrow('sibling lifecycle failed');
    expect([...operations.values()].map(({ status }) => status)).toEqual([
      'cancelled',
      'completed',
      'cancelled',
    ]);

    await expect(
      lifecycle.run({ ...command, signal: new AbortController().signal }),
    ).rejects.toMatchObject({
      code: 'TOOL_CALL_ALREADY_RUNNING',
      execution: 'not-started',
    });
    expect(executionCount).toBe(1);

    settleFirstExecution({ content: 'ignored-after-cancellation', success: true });
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    await expect(
      lifecycle.run({ ...command, signal: new AbortController().signal }),
    ).resolves.toMatchObject({ result: { content: 'done', success: true } });
    expect(executionCount).toBe(2);
    expect([...operations.values()].every(({ status }) => status !== 'running')).toBe(true);
  });

  it('reports exhausted result synchronization after one local execution', async () => {
    const { calls, dependencies, operations } = createHarness();
    dependencies.messages.commitResult = async () => {
      calls.push('commit');
      throw Object.assign(new Error('gateway unavailable'), { code: 'ECONNRESET' });
    };
    dependencies.retry = {
      attemptTimeoutMs: 10_000,
      clock: { now: () => 0, sleep: async () => {} },
      delaysMs: [0, 3000],
      isRetryable: () => true,
      jitterRatio: 0,
      random: () => 0.5,
      totalTimeoutMs: 45_000,
    };

    await expect(
      new ToolCallLifecycle(dependencies).run({
        context: { agentId: 'agent-1', topicId: 'topic-1' },
        message: {
          kind: 'create',
          messageId: 'tool-message-1',
          parentMessageId: 'assistant-message-1',
        },
        toolCall: {
          apiName: 'runCommand',
          arguments: '{"command":"pwd"}',
          id: 'tool-call-1',
          identifier: 'local-system',
          type: 'builtin',
        },
      }),
    ).rejects.toMatchObject({
      code: 'RESULT_SYNC_RETRY_EXHAUSTED',
      execution: 'completed',
      phase: 'sync-result',
    });
    expect(calls).toEqual(['ensure', 'execute', 'commit', 'commit']);
    expect([...operations.values()].map(({ status }) => status)).toEqual([
      'failed',
      'completed',
      'completed',
      'failed',
    ]);
  });
});
