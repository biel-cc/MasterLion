import { describe, expect, it, vi } from 'vitest';

import { hasConfiguredAgentEnv, routeManagedEnvRuntime } from '../managedEnvRuntime';

describe('routeManagedEnvRuntime', () => {
  it('forces desktop standalone execution through gateway when managed env exists', async () => {
    const getManagedEnvSummary = vi.fn().mockResolvedValue({ hasManagedEnv: true });

    await expect(
      routeManagedEnvRuntime('client', { topicId: 'topic-1' }, { getManagedEnvSummary }, true),
    ).resolves.toBe('gateway');
    expect(getManagedEnvSummary).toHaveBeenCalledWith({ topicId: 'topic-1' });
  });

  it('fails closed to gateway when the value-free authority probe is unavailable', async () => {
    const getManagedEnvSummary = vi.fn().mockRejectedValue(new Error('offline'));

    await expect(
      routeManagedEnvRuntime('hetero', { topicId: 'topic-1' }, { getManagedEnvSummary }, true),
    ).resolves.toBe('gateway');
  });

  it('forces gateway from browser-visible agent env without probing the server', async () => {
    const getManagedEnvSummary = vi.fn().mockResolvedValue({ hasManagedEnv: false });

    expect(hasConfiguredAgentEnv({ env: { AGENT_MODE: 'review' } })).toBe(true);
    expect(
      hasConfiguredAgentEnv({
        env: {},
        heterogeneousProvider: { env: { LEGACY_MODE: 'ignored' }, type: 'claude-code' },
      }),
    ).toBe(false);
    await expect(
      routeManagedEnvRuntime(
        'client',
        { hasAgentEnv: true, topicId: 'topic-1' },
        { getManagedEnvSummary },
        true,
      ),
    ).resolves.toBe('gateway');
    expect(getManagedEnvSummary).not.toHaveBeenCalled();

    await expect(
      routeManagedEnvRuntime(
        'hetero',
        { hasAgentEnv: true, topicId: 'topic-1' },
        { getManagedEnvSummary },
        true,
      ),
    ).resolves.toBe('hetero');
    expect(getManagedEnvSummary).toHaveBeenCalledWith({ topicId: 'topic-1' });
  });

  it('preserves ordinary desktop and all web runtime choices', async () => {
    const getManagedEnvSummary = vi.fn().mockResolvedValue({ hasManagedEnv: false });

    await expect(
      routeManagedEnvRuntime('hetero', { topicId: 'topic-1' }, { getManagedEnvSummary }, true),
    ).resolves.toBe('hetero');
    await expect(
      routeManagedEnvRuntime('client', { topicId: 'topic-1' }, { getManagedEnvSummary }, false),
    ).resolves.toBe('client');
  });
});
