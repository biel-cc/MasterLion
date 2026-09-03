import { describe, expect, it, vi } from 'vitest';

import { StoredExecutionEnvService } from './storedExecutionEnv';

const entry = (value: string, secret = false) => ({ secret, value });

describe('StoredExecutionEnvService', () => {
  it('merges user, workspace, and agent values with the frozen precedence', async () => {
    const decrypt = vi.fn(async (value: string) => value.replace('sealed:', ''));
    const service = new StoredExecutionEnvService({
      decrypt,
      loadUserEnv: async () => ({
        SHARED: entry('sealed:user', true),
        USER_ONLY: entry('sealed:user-only', true),
      }),
      loadWorkspaceEnv: async () => ({
        SHARED: entry('sealed:workspace', true),
        WORKSPACE_ONLY: entry('sealed:workspace-only'),
      }),
    });

    const result = await service.resolve({
      agentEnv: { AGENT_ONLY: 'agent', SHARED: 'agent' },
      agentId: 'agent-1',
      operationId: 'operation-1',
      topicId: 'topic-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    expect(result.values).toEqual({
      AGENT_ONLY: 'agent',
      SHARED: 'agent',
      USER_ONLY: 'user-only',
      WORKSPACE_ONLY: 'workspace-only',
    });
    expect(result.sources).toMatchObject({
      AGENT_ONLY: 'agent',
      SHARED: 'agent',
      USER_ONLY: 'user',
      WORKSPACE_ONLY: 'workspace',
    });
    expect(result.secretKeys).toEqual(['USER_ONLY']);
    // Only winning persisted entries are decrypted; overridden values stay sealed.
    expect(decrypt).toHaveBeenCalledTimes(2);
  });

  it('uses heterogeneous provider env only when agencyConfig.env is absent', async () => {
    const service = new StoredExecutionEnvService({
      decrypt: async (value) => value,
      loadUserEnv: async () => undefined,
      loadWorkspaceEnv: async () => undefined,
    });

    await expect(
      service.resolveAgencyConfig({
        agencyConfig: {
          env: { MODE: 'new' },
          heterogeneousProvider: { env: { MODE: 'legacy' }, type: 'codex' },
        },
        agentId: 'agent-1',
        operationId: 'operation-1',
        userId: 'user-1',
      }),
    ).resolves.toMatchObject({ values: { MODE: 'new' } });

    await expect(
      service.resolveAgencyConfig({
        agencyConfig: { heterogeneousProvider: { env: { MODE: 'legacy' }, type: 'codex' } },
        agentId: 'agent-1',
        operationId: 'operation-2',
        userId: 'user-1',
      }),
    ).resolves.toMatchObject({ values: { MODE: 'legacy' } });
  });
});
