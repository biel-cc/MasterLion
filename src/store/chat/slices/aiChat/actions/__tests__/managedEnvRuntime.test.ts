import { describe, expect, it, vi } from 'vitest';

import { routeDesktopWorkspaceRuntime } from '../managedEnvRuntime';

describe('routeDesktopWorkspaceRuntime', () => {
  it('forces desktop heterogeneous execution through gateway when managed env exists', async () => {
    const getManagedEnvSummary = vi.fn().mockResolvedValue({ hasManagedEnv: true });

    await expect(
      routeDesktopWorkspaceRuntime(
        'hetero',
        { topicId: 'topic-1', workspaceId: 'workspace-1' },
        { getManagedEnvSummary },
        true,
      ),
    ).resolves.toBe('gateway');
    expect(getManagedEnvSummary).toHaveBeenCalledWith({
      topicId: 'topic-1',
      workspaceId: 'workspace-1',
    });
  });

  it('fails closed to gateway when the value-free authority probe is unavailable', async () => {
    const getManagedEnvSummary = vi.fn().mockRejectedValue(new Error('offline'));

    await expect(
      routeDesktopWorkspaceRuntime(
        'hetero',
        { topicId: 'topic-1' },
        { getManagedEnvSummary },
        true,
      ),
    ).resolves.toBe('gateway');
  });

  it('preserves desktop heterogeneous and all web runtime choices', async () => {
    const getManagedEnvSummary = vi.fn().mockResolvedValue({ hasManagedEnv: false });

    await expect(
      routeDesktopWorkspaceRuntime(
        'hetero',
        { topicId: 'topic-1' },
        { getManagedEnvSummary },
        true,
      ),
    ).resolves.toBe('hetero');
    await expect(
      routeDesktopWorkspaceRuntime(
        'client',
        { topicId: 'topic-1', workspaceId: 'workspace-1' },
        { getManagedEnvSummary },
        true,
      ),
    ).resolves.toBe('gateway');
    expect(getManagedEnvSummary).toHaveBeenCalledTimes(1);
    await expect(
      routeDesktopWorkspaceRuntime(
        'client',
        { topicId: 'topic-1' },
        { getManagedEnvSummary },
        false,
      ),
    ).resolves.toBe('client');
  });

  it('routes bound and unbound desktop clients through the coordinator without probing env', async () => {
    const getManagedEnvSummary = vi.fn().mockResolvedValue({ hasManagedEnv: false });

    await expect(
      routeDesktopWorkspaceRuntime(
        'client',
        { topicId: 'topic-1', workspaceId: 'workspace-1' },
        { getManagedEnvSummary },
        true,
      ),
    ).resolves.toBe('gateway');
    await expect(
      routeDesktopWorkspaceRuntime(
        'client',
        { topicId: 'topic-1' },
        { getManagedEnvSummary },
        true,
      ),
    ).resolves.toBe('gateway');
    expect(getManagedEnvSummary).not.toHaveBeenCalled();
  });
});
