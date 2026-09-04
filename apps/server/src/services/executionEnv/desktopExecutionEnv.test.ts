import { describe, expect, it, vi } from 'vitest';

import { resolveDesktopExecutionEnv } from './desktopExecutionEnv';

describe('resolveDesktopExecutionEnv', () => {
  it('resolves the topic-bound workspace and returns plaintext values only to the device caller', async () => {
    const result = await resolveDesktopExecutionEnv(
      { agentId: 'agent-a', topicId: 'topic-a', workspaceId: 'workspace-a' },
      {
        decrypt: vi.fn(async (value) => `plain:${value}`),
        loadAgentAgencyConfig: vi.fn(async () => ({
          env: { AGENT_ONLY: 'agent', SHARED: 'agent' },
        })),
        loadTopicWorkspaceId: vi.fn(async () => 'workspace-a'),
        loadUserEnv: vi.fn(async () => ({
          SHARED: { secret: true, value: 'enc-user' },
          USER_ONLY: { secret: true, value: 'enc-user-only' },
        })),
        loadWorkspaceEnv: vi.fn(async () => ({
          SHARED: { secret: true, value: 'enc-workspace' },
          WORKSPACE_ONLY: { secret: false, value: 'enc-workspace-only' },
        })),
        userId: 'user-a',
      },
    );

    expect(result).toEqual({
      AGENT_ONLY: 'agent',
      SHARED: 'agent',
      USER_ONLY: 'plain:enc-user-only',
      WORKSPACE_ONLY: 'plain:enc-workspace-only',
    });
  });

  it('rejects a renderer workspace reference that disagrees with the topic binding', async () => {
    await expect(
      resolveDesktopExecutionEnv(
        { agentId: 'agent-a', topicId: 'topic-a', workspaceId: 'workspace-forged' },
        {
          decrypt: vi.fn(),
          loadAgentAgencyConfig: vi.fn(async () => ({})),
          loadTopicWorkspaceId: vi.fn(async () => 'workspace-bound'),
          loadUserEnv: vi.fn(),
          loadWorkspaceEnv: vi.fn(),
          userId: 'user-a',
        },
      ),
    ).rejects.toThrow('Workspace reference does not match the topic binding');
  });
});
