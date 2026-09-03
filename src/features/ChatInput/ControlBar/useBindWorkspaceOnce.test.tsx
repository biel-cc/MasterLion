/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EffectiveWorkspace } from '@/hooks/useEffectiveWorkspace';

import { useBindWorkspaceOnce } from './useBindWorkspaceOnce';

const mocks = vi.hoisted(() => ({
  bindTopicWorkspace: vi.fn(),
  getOrCreateDeviceWorkspace: vi.fn(),
  setDraftWorkspaceIntent: vi.fn(),
  switchTopic: vi.fn(),
  updateDeviceCwd: vi.fn(),
}));

vi.mock('@/store/projectWorkspace', () => ({
  useProjectWorkspaceStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector(mocks),
}));

vi.mock('@/store/device', () => ({
  useDeviceStore: (selector: (state: Record<string, unknown>) => unknown) => selector(mocks),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: { getState: () => ({ switchTopic: mocks.switchTopic }) },
}));

const effective = (overrides: Partial<EffectiveWorkspace> = {}): EffectiveWorkspace => ({
  context: { plan: { deviceId: 'device-1', kind: 'device', target: 'local' }, version: 1 },
  draftKey: 'agent-1::group-1',
  isDraft: true,
  recommendation: { deviceId: 'device-1' },
  state: 'unbound',
  target: 'local',
  targetDeviceId: 'device-1',
  ...overrides,
});

const workspace = {
  deviceId: 'device-1',
  id: 'workspace-1',
  kind: 'device' as const,
  rootPath: '/projects/app',
};

describe('useBindWorkspaceOnce', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOrCreateDeviceWorkspace.mockResolvedValue({ ok: true, value: workspace });
    mocks.bindTopicWorkspace.mockResolvedValue({ ok: true, value: {} });
    mocks.updateDeviceCwd.mockResolvedValue(undefined);
  });

  it('stores only draft intent until topic creation performs the atomic bind', async () => {
    const { result } = renderHook(() => useBindWorkspaceOnce(effective()));

    await act(() => result.current.select({ path: '/projects/app', repoType: 'git' }));

    expect(mocks.getOrCreateDeviceWorkspace).toHaveBeenCalledWith({
      deviceId: 'device-1',
      repoType: 'git',
      rootPath: '/projects/app',
    });
    expect(mocks.setDraftWorkspaceIntent).toHaveBeenCalledWith('agent-1::group-1', {
      target: 'local',
      targetDeviceId: 'device-1',
      workspaceId: 'workspace-1',
    });
    expect(mocks.bindTopicWorkspace).not.toHaveBeenCalled();
    expect(mocks.updateDeviceCwd).toHaveBeenCalledWith(
      'device-1',
      { path: '/projects/app', repoType: 'git' },
      { setDefault: false },
    );
  });

  it('binds an existing unbound topic once', async () => {
    const { result } = renderHook(() =>
      useBindWorkspaceOnce(effective({ isDraft: false, topicId: 'topic-1' })),
    );

    await act(() => result.current.select({ path: '/projects/app' }));

    expect(mocks.bindTopicWorkspace).toHaveBeenCalledWith({
      target: 'local',
      topicId: 'topic-1',
      workspaceId: 'workspace-1',
    });
    expect(mocks.setDraftWorkspaceIntent).not.toHaveBeenCalled();
  });

  it.each(['bound', 'scratch'] as const)(
    'keeps a %s topic read-only and creates a referenced draft instead',
    async (state) => {
      const { result } = renderHook(() =>
        useBindWorkspaceOnce(effective({ isDraft: false, state, topicId: 'topic-1' })),
      );

      expect(await result.current.select({ path: '/projects/app' })).toBe(false);
      expect(mocks.getOrCreateDeviceWorkspace).not.toHaveBeenCalled();

      await act(() => result.current.startReferencedTopic({ path: '/projects/app' }));
      expect(mocks.setDraftWorkspaceIntent).toHaveBeenCalledWith('agent-1::group-1', {
        referenceTopicId: 'topic-1',
        target: 'local',
        targetDeviceId: 'device-1',
        workspaceId: 'workspace-1',
      });
      expect(mocks.switchTopic).toHaveBeenCalledWith(null, { skipRefreshMessage: true });
    },
  );

  it('does no workspace work for a native pure-chat target', async () => {
    const { result } = renderHook(() =>
      useBindWorkspaceOnce(
        effective({
          context: { plan: { kind: 'none', target: 'none' }, version: 1 },
          recommendation: {},
          target: 'none',
          targetDeviceId: undefined,
        }),
      ),
    );

    expect(result.current.canSelect).toBe(false);
    expect(await result.current.select({ path: '/projects/app' })).toBe(false);
    expect(mocks.getOrCreateDeviceWorkspace).not.toHaveBeenCalled();
    expect(mocks.setDraftWorkspaceIntent).not.toHaveBeenCalled();
  });
});
