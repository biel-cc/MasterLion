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
  legacyCommit: vi.fn(),
  seamAvailable: true,
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

vi.mock('./useCommitWorkingDirectory', () => ({
  useCommitWorkingDirectory: () => ({ commit: mocks.legacyCommit }),
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
    mocks.seamAvailable = true;
    mocks.getOrCreateDeviceWorkspace.mockResolvedValue({ ok: true, value: workspace });
    mocks.bindTopicWorkspace.mockResolvedValue({ ok: true, value: {} });
    mocks.updateDeviceCwd.mockResolvedValue(undefined);
  });

  it('uses legacy cwd fields without calling workspace procedures on an old server', async () => {
    mocks.seamAvailable = false;
    const { result } = renderHook(() => useBindWorkspaceOnce(effective(), 'agent-1'));

    let selected!: boolean;
    await act(async () => {
      selected = await result.current.select({ path: '/projects/legacy', repoType: 'git' });
    });

    expect(selected).toBe(true);
    expect(mocks.legacyCommit).toHaveBeenCalledWith({
      path: '/projects/legacy',
      repoType: 'git',
    });
    expect(mocks.setDraftWorkspaceIntent).toHaveBeenCalledWith('agent-1::group-1', {
      legacyWorkingDirectory: '/projects/legacy',
      target: 'local',
      targetDeviceId: 'device-1',
    });
    expect(mocks.getOrCreateDeviceWorkspace).not.toHaveBeenCalled();
    expect(mocks.bindTopicWorkspace).not.toHaveBeenCalled();
  });

  it('finishes the same selection through legacy fields when the first mutation discovers an old server', async () => {
    mocks.getOrCreateDeviceWorkspace.mockResolvedValue({
      code: 'SEAM_UNAVAILABLE',
      ok: false,
    });
    const { result } = renderHook(() => useBindWorkspaceOnce(effective(), 'agent-1'));

    let selected!: boolean;
    await act(async () => {
      selected = await result.current.select({ path: '/projects/legacy' });
    });

    expect(selected).toBe(true);
    expect(mocks.legacyCommit).toHaveBeenCalledWith({ path: '/projects/legacy' });
    expect(mocks.setDraftWorkspaceIntent).toHaveBeenCalledWith('agent-1::group-1', {
      legacyWorkingDirectory: '/projects/legacy',
      target: 'local',
      targetDeviceId: 'device-1',
    });
    expect(result.current.error).toBeUndefined();
  });

  it('keeps an old-server topic editable without offering formal referenced-topic binding', () => {
    mocks.seamAvailable = false;
    const { result } = renderHook(() =>
      useBindWorkspaceOnce(
        effective({ isDraft: false, state: 'bound', topicId: 'topic-legacy' }),
        'agent-1',
      ),
    );

    expect(result.current.canSelect).toBe(true);
    expect(result.current.canStartReferencedTopic).toBe(false);
  });

  it('stores only draft intent until topic creation performs the atomic bind', async () => {
    const { result } = renderHook(() => useBindWorkspaceOnce(effective(), 'agent-1'));

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

  it('keeps a rejected nonexistent directory out of draft, binding, and recents', async () => {
    mocks.getOrCreateDeviceWorkspace.mockResolvedValue({
      code: 'UNKNOWN',
      message: 'The selected directory does not exist or cannot be verified on the target device',
      ok: false,
    });
    const { result } = renderHook(() => useBindWorkspaceOnce(effective(), 'agent-1'));

    let selected!: boolean;
    await act(async () => {
      selected = await result.current.select({ path: '/missing/project' });
    });

    expect(selected).toBe(false);
    expect(result.current.error).toEqual({
      code: 'UNKNOWN',
      message: 'The selected directory does not exist or cannot be verified on the target device',
    });
    expect(mocks.setDraftWorkspaceIntent).not.toHaveBeenCalled();
    expect(mocks.bindTopicWorkspace).not.toHaveBeenCalled();
    expect(mocks.updateDeviceCwd).not.toHaveBeenCalled();
  });

  it('records the server-canonicalized directory instead of the renderer path', async () => {
    mocks.getOrCreateDeviceWorkspace.mockResolvedValue({
      ok: true,
      value: { ...workspace, rootPath: '/canonical/project' },
    });
    const { result } = renderHook(() => useBindWorkspaceOnce(effective(), 'agent-1'));

    await act(() => result.current.select({ path: '/linked/project', repoType: 'git' }));

    expect(mocks.updateDeviceCwd).toHaveBeenCalledWith(
      'device-1',
      { path: '/canonical/project', repoType: 'git' },
      { setDefault: false },
    );
  });

  it('binds an existing unbound topic once', async () => {
    const { result } = renderHook(() =>
      useBindWorkspaceOnce(effective({ isDraft: false, topicId: 'topic-1' }), 'agent-1'),
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
        useBindWorkspaceOnce(effective({ isDraft: false, state, topicId: 'topic-1' }), 'agent-1'),
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
        'agent-1',
      ),
    );

    expect(result.current.canSelect).toBe(false);
    expect(await result.current.select({ path: '/projects/app' })).toBe(false);
    expect(mocks.getOrCreateDeviceWorkspace).not.toHaveBeenCalled();
    expect(mocks.setDraftWorkspaceIntent).not.toHaveBeenCalled();
  });
});
