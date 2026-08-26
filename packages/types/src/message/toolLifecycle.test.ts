import { describe, expect, it } from 'vitest';

import { CommitToolResultInputSchema, EnsureToolMessageInputSchema } from './toolLifecycle';

describe('EnsureToolMessageInputSchema', () => {
  it('accepts a stable immutable tool-message intent', () => {
    const input = {
      agentId: 'agent-1',
      groupId: null,
      id: 'msg_stable-tool-message',
      mode: 'confirm-existing',
      parentMessageId: 'msg_assistant',
      threadId: null,
      toolCall: {
        apiName: 'runCommand',
        arguments: '{"command":"pwd"}',
        executor: 'client',
        identifier: 'lobe-local-system',
        intervention: { status: 'approved' },
        result_msg_id: 'provider-result-1',
        source: 'builtin',
        thoughtSignature: 'signed-thought',
        toolCallId: 'call_1',
        type: 'builtin',
      },
      topicId: 'topic-1',
    };

    expect(EnsureToolMessageInputSchema.parse(input)).toEqual(input);
  });

  it('rejects caller-controlled message fields', () => {
    const result = EnsureToolMessageInputSchema.safeParse({
      agentId: 'agent-1',
      content: 'caller-controlled',
      id: 'msg_stable-tool-message',
      parentMessageId: 'msg_assistant',
      role: 'assistant',
      toolCall: {
        apiName: 'runCommand',
        arguments: '{}',
        identifier: 'lobe-local-system',
        toolCallId: 'call_1',
        type: 'builtin',
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects an unsupported tool render type', () => {
    const result = EnsureToolMessageInputSchema.safeParse({
      agentId: 'agent-1',
      id: 'msg_stable-tool-message',
      parentMessageId: 'msg_assistant',
      toolCall: {
        apiName: 'runCommand',
        arguments: '{}',
        identifier: 'lobe-local-system',
        toolCallId: 'call_1',
        type: 'unsupported',
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects unsupported execution routing values', () => {
    const result = EnsureToolMessageInputSchema.safeParse({
      agentId: 'agent-1',
      id: 'msg_stable-tool-message',
      parentMessageId: 'msg_assistant',
      toolCall: {
        apiName: 'runCommand',
        arguments: '{}',
        executor: 'somewhere-else',
        identifier: 'lobe-local-system',
        source: 'unknown-source',
        toolCallId: 'call_1',
        type: 'builtin',
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects an unknown ensure mode', () => {
    const result = EnsureToolMessageInputSchema.safeParse({
      agentId: 'agent-1',
      id: 'msg_stable-tool-message',
      mode: 'create-always',
      parentMessageId: 'msg_assistant',
      toolCall: {
        apiName: 'runCommand',
        arguments: '{}',
        identifier: 'lobe-local-system',
        toolCallId: 'call_1',
        type: 'builtin',
      },
    });

    expect(result.success).toBe(false);
  });
});

describe('CommitToolResultInputSchema', () => {
  it('accepts a stable execution attempt and the complete builtin result', () => {
    const input = {
      executionAttemptId: 'tool_execution_attempt_1',
      id: 'msg_stable-tool-message',
      result: {
        content: 'command output',
        error: {
          body: { exitCode: 1 },
          message: 'command failed',
          type: 'BuiltinToolExecutorError',
        },
        metadata: { toolExecutionTimeMs: 42 },
        state: { stdout: 'command output' },
        stop: true,
        success: false,
      },
    };

    expect(CommitToolResultInputSchema.parse(input)).toEqual(input);
  });

  it('rejects a caller-supplied result fingerprint', () => {
    const result = CommitToolResultInputSchema.safeParse({
      executionAttemptId: 'tool_execution_attempt_1',
      id: 'msg_stable-tool-message',
      result: { success: true },
      resultFingerprint: 'caller-controlled',
    });

    expect(result.success).toBe(false);
  });

  it('requires the builtin result success discriminator', () => {
    const result = CommitToolResultInputSchema.safeParse({
      executionAttemptId: 'tool_execution_attempt_1',
      id: 'msg_stable-tool-message',
      result: { content: 'missing success' },
    });

    expect(result.success).toBe(false);
  });
});
