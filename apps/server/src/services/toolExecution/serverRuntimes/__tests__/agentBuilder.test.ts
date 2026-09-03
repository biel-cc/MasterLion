import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentBuilderRuntime } from '../agentBuilder';

const { mockGetAgentConfigById, mockUpdateConfig } = vi.hoisted(() => ({
  mockGetAgentConfigById: vi.fn(),
  mockUpdateConfig: vi.fn(),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(() => ({
    getAgentConfigById: mockGetAgentConfigById,
    updateConfig: mockUpdateConfig,
  })),
}));

vi.mock('@/database/models/plugin', () => ({ PluginModel: vi.fn(() => ({})) }));
vi.mock('@/database/repositories/aiInfra', () => ({ AiInfraRepos: vi.fn(() => ({})) }));
vi.mock('@/server/services/discover', () => ({ DiscoverService: vi.fn(() => ({})) }));

const createRuntime = () =>
  agentBuilderRuntime.factory({
    agentId: 'agent-1',
    serverDB: {} as never,
    toolManifestMap: {},
    userId: 'user-1',
  });

describe('agentBuilderRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgentConfigById.mockResolvedValue({ id: 'agent-1', plugins: [] });
  });

  it('rejects reserved agent env keys before persisting finalConfig', async () => {
    const runtime = createRuntime();

    const result = await runtime.updateConfig(
      { config: { agencyConfig: { env: { NODE_OPTIONS: '--require=/tmp/inject.js' } } } } as any,
      { agentId: 'agent-1', toolManifestMap: {} },
    );

    expect(result.success).toBe(false);
    expect(result.content).toContain('managed by the execution runtime: NODE_OPTIONS');
    expect(mockUpdateConfig).not.toHaveBeenCalled();
  });

  it('keeps the plugin-only narrow update path working', async () => {
    const runtime = createRuntime();

    const result = await runtime.updateConfig(
      { togglePlugin: { enabled: true, pluginId: 'safe-plugin' } },
      { agentId: 'agent-1', toolManifestMap: {} },
    );

    expect(result.success).toBe(true);
    expect(mockUpdateConfig).toHaveBeenCalledWith('agent-1', { plugins: ['safe-plugin'] });
  });
});
