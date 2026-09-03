import { describe, expect, it, vi } from 'vitest';

import type {
  ExecutionEnv,
  ExecutionEnvAdapter,
  ExecutionEnvLayer,
} from '@lobechat/types/src/executionContext';
import type { ProjectWorkspaceEnvRecord } from '@lobechat/types/src/projectWorkspace';

import {
  createExecutionEnvAdapter,
  ExecutionEnvError,
  parseExecutionEnvFile,
  redactExecutionEnvData,
  resolveOperationExecutionEnv,
  summarizeExecutionEnv,
  toBrowserExecutionEnv,
} from '..';

const entry = (value: string, secret = false) => ({ secret, value });

const createLayerLoader = (
  layers: Partial<Record<ExecutionEnvLayer, ProjectWorkspaceEnvRecord>>,
) => vi.fn(async (layer: ExecutionEnvLayer) => layers[layer]);

describe('createExecutionEnvAdapter', () => {
  it('uses host < user < workspace < topic < agent < call precedence', async () => {
    const adapter = createExecutionEnvAdapter({
      decryptSecret: async ({ encryptedValue }) => `plain:${encryptedValue}`,
      loadLayer: createLayerLoader({
        agent: { SHARED: entry('agent') },
        call: { CALL_ONLY: entry('call'), SHARED: entry('call') },
        host: { HOST_ONLY: entry('host'), SHARED: entry('host') },
        topic: { SHARED: entry('topic'), TOPIC_ONLY: entry('topic') },
        user: { SHARED: entry('user') },
        workspace: { SHARED: entry('workspace'), WORKSPACE_ONLY: entry('workspace') },
      }),
    });

    const result = await adapter.resolve({
      agentId: 'agent-1',
      operationId: 'operation-1',
      topicId: 'topic-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    expect(result.values).toEqual({
      CALL_ONLY: 'call',
      HOST_ONLY: 'host',
      SHARED: 'call',
      TOPIC_ONLY: 'topic',
      WORKSPACE_ONLY: 'workspace',
    });
    expect(result.sources.SHARED).toBe('call');
  });

  it('keeps runtime-reserved and security-sensitive values under host control', async () => {
    const adapter = createExecutionEnvAdapter({
      decryptSecret: async ({ encryptedValue }) => encryptedValue,
      loadLayer: createLayerLoader({
        call: {
          BASH_ENV: entry('/untrusted/hook'),
          LOBEHUB_JWT: entry('untrusted-token', true),
          NODE_OPTIONS: entry('--require untrusted'),
          PATH: entry('/untrusted/bin'),
          SAFE_KEY: entry('call-value'),
        },
        host: {
          BASH_ENV: entry('/runtime/hook'),
          LOBEHUB_JWT: entry('runtime-token', true),
          NODE_OPTIONS: entry('--runtime-option'),
          PATH: entry('/runtime/bin'),
        },
      }),
    });

    const result = await adapter.resolve({
      agentId: 'agent-1',
      operationId: 'operation-1',
      userId: 'user-1',
    });

    expect(result.values).toEqual({
      BASH_ENV: '/runtime/hook',
      LOBEHUB_JWT: 'runtime-token',
      NODE_OPTIONS: '--runtime-option',
      PATH: '/runtime/bin',
      SAFE_KEY: 'call-value',
    });
    expect(result.sources.PATH).toBe('host');
    expect(result.secretKeys).toContain('LOBEHUB_JWT');
  });

  it('decrypts winning secret values only on the server and projects names only', async () => {
    const decryptSecret = vi.fn(async ({ encryptedValue }: { encryptedValue: string }) =>
      encryptedValue.replace('encrypted:', ''),
    );
    const adapter = createExecutionEnvAdapter({
      decryptSecret,
      loadLayer: createLayerLoader({
        user: {
          API_TOKEN: entry('encrypted:overridden-secret', true),
        },
        workspace: {
          API_TOKEN: entry('encrypted:server-secret', true),
          DISPLAY_MODE: entry('compact'),
        },
      }),
    });

    const result = await adapter.resolve({
      agentId: 'agent-1',
      operationId: 'operation-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    expect(decryptSecret).toHaveBeenCalledOnce();
    expect(result.values.API_TOKEN).toBe('server-secret');
    expect(adapter.summarize(result)).toEqual({
      keys: ['API_TOKEN', 'DISPLAY_MODE'],
      secretKeys: ['API_TOKEN'],
    });
    expect(toBrowserExecutionEnv(result)).toEqual([
      { key: 'API_TOKEN', secret: true },
      { key: 'DISPLAY_MODE', secret: false },
    ]);
    expect(JSON.stringify(toBrowserExecutionEnv(result))).not.toContain('server-secret');
  });

  it('rejects invalid keys without copying their values into the error', async () => {
    const adapter = createExecutionEnvAdapter({
      decryptSecret: async ({ encryptedValue }) => encryptedValue,
      loadLayer: createLayerLoader({ workspace: { 'BAD-KEY': entry('private-value') } }),
    });

    await expect(
      adapter.resolve({ agentId: 'agent-1', operationId: 'operation-1', userId: 'user-1' }),
    ).rejects.toMatchObject({ code: 'INVALID_ENV_KEY' });

    try {
      await adapter.resolve({ agentId: 'agent-1', operationId: 'operation-1', userId: 'user-1' });
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain('private-value');
    }
  });

  it('discards storage and decryption error details', async () => {
    const loadingAdapter = createExecutionEnvAdapter({
      decryptSecret: async ({ encryptedValue }) => encryptedValue,
      loadLayer: async () => {
        throw new Error('storage included private-value');
      },
    });
    await expect(
      loadingAdapter.resolve({ agentId: 'agent-1', operationId: 'operation-1', userId: 'user-1' }),
    ).rejects.toEqual(
      new ExecutionEnvError('LOAD_FAILED', 'Unable to load the execution environment.'),
    );

    const decryptingAdapter = createExecutionEnvAdapter({
      decryptSecret: async () => {
        throw new Error('decrypt included private-value');
      },
      loadLayer: createLayerLoader({ workspace: { API_TOKEN: entry('ciphertext', true) } }),
    });
    await expect(
      decryptingAdapter.resolve({
        agentId: 'agent-1',
        operationId: 'operation-1',
        userId: 'user-1',
      }),
    ).rejects.not.toHaveProperty('message', expect.stringContaining('private-value'));
  });
});

describe('parseExecutionEnvFile', () => {
  it('parses exports, quotes, comments, empty values, and secret flags', () => {
    const result = parseExecutionEnvFile(
      [
        '# workspace environment',
        'export PLAIN=value',
        'DOUBLE="line\\nvalue" # comment',
        "SINGLE='literal # value'",
        'INLINE=value # comment',
        'EMPTY=',
      ].join('\n'),
      { secretKeys: ['DOUBLE'] },
    );

    expect(result).toEqual({
      DOUBLE: entry('line\nvalue', true),
      EMPTY: entry(''),
      INLINE: entry('value'),
      PLAIN: entry('value'),
      SINGLE: entry('literal # value'),
    });
  });

  it('rejects malformed and runtime-owned entries without echoing source values', () => {
    expect(() => parseExecutionEnvFile('not-an-assignment')).toThrow(/line 1/i);
    expect(() => parseExecutionEnvFile('PATH=/private-value')).toThrow(/managed by the execution/);

    try {
      parseExecutionEnvFile('BROKEN="private-value');
    } catch (error) {
      expect((error as Error).message).not.toContain('private-value');
    }
  });
});

describe('operation boundary and redaction', () => {
  it.each(['P1', 'P3', 'P4'])('%s consumes the same operation resolver', async () => {
    const resolved: ExecutionEnv = {
      secretKeys: ['TOKEN'],
      sources: { TOKEN: 'workspace' },
      values: { TOKEN: 'server-secret' },
    };
    const adapter: ExecutionEnvAdapter = {
      resolve: vi.fn(async () => resolved),
      summarize: summarizeExecutionEnv,
    };

    const result = await resolveOperationExecutionEnv({
      adapter,
      envRef: { agentId: 'agent-1', topicId: 'topic-1', workspaceId: 'workspace-1' },
      operationId: 'operation-1',
      userId: 'user-1',
    });

    expect(result).toBe(resolved);
    expect(adapter.resolve).toHaveBeenCalledWith({
      agentId: 'agent-1',
      operationId: 'operation-1',
      topicId: 'topic-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });
  });

  it('does not execute an adapter without a resolved environment reference', async () => {
    const adapter: ExecutionEnvAdapter = {
      resolve: vi.fn(),
      summarize: summarizeExecutionEnv,
    };

    await expect(
      resolveOperationExecutionEnv({ adapter, operationId: 'operation-1', userId: 'user-1' }),
    ).rejects.toMatchObject({ code: 'ENV_REF_REQUIRED' });
    expect(adapter.resolve).not.toHaveBeenCalled();
  });

  it('redacts all resolved values from strings, errors, and diagnostic data', () => {
    const env: ExecutionEnv = {
      secretKeys: ['TOKEN'],
      sources: { MODE: 'workspace', TOKEN: 'workspace' },
      values: { MODE: 'private-mode', TOKEN: 'server-secret' },
    };

    const redacted = redactExecutionEnvData(
      {
        error: new Error('request failed for server-secret'),
        trace: ['TOKEN=server-secret', 'MODE=private-mode'],
      },
      env,
    );

    expect(JSON.stringify(redacted)).toContain('[redacted]');
    expect(JSON.stringify(redacted)).not.toContain('server-secret');
    expect(JSON.stringify(redacted)).not.toContain('private-mode');
  });
});
