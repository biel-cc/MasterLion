import type { TopicExecutionSnapshot } from '@lobechat/types/src/projectWorkspace';
import { describe, expect, it, vi } from 'vitest';

import { ProjectWorkspaceModel } from '@/database/models/projectWorkspace';

import { type TopicWorkspaceBindingStore, WorkspaceAlreadyBoundError } from './bindingStore';
import { ProjectWorkspaceService } from './index';

const snapshot: TopicExecutionSnapshot = {
  target: 'local',
  targetCapturedAt: '2026-09-03T00:00:00.000Z',
  version: 1,
};

const createService = () => {
  const workspaceModel = new ProjectWorkspaceModel({} as never, 'user-a');
  const resolveDeviceWorkspacePath = vi.fn();
  const bindingStore: TopicWorkspaceBindingStore = {
    bind: async () => {
      throw new Error('not implemented');
    },
    captureTarget: async () => snapshot,
    captureTargetIfAbsent: async () => snapshot,
    getState: async () => ({ snapshot }),
  };
  return {
    bindingStore,
    resolveDeviceWorkspacePath,
    service: new ProjectWorkspaceService({
      bindingStore,
      resolveDeviceWorkspacePath,
      workspaceModel,
    }),
    workspaceModel,
  };
};

describe('ProjectWorkspaceService', () => {
  it('rejects an unresolvable device directory before persisting a workspace', async () => {
    const { resolveDeviceWorkspacePath, service, workspaceModel } = createService();
    resolveDeviceWorkspacePath.mockResolvedValue(undefined);
    const getOrCreate = vi.spyOn(workspaceModel, 'getOrCreate');

    await expect(
      service.getOrCreate({
        deviceId: 'device-a',
        kind: 'device',
        rootPath: '/missing/project',
      }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: expect.stringContaining('does not exist or cannot be verified'),
    });

    expect(resolveDeviceWorkspacePath).toHaveBeenCalledWith({
      deviceId: 'device-a',
      path: '/missing/project',
    });
    expect(getOrCreate).not.toHaveBeenCalled();
  });

  it('persists only the device-authored canonical directory path', async () => {
    const { resolveDeviceWorkspacePath, service, workspaceModel } = createService();
    const createdAt = new Date('2026-09-03T00:00:00.000Z');
    resolveDeviceWorkspacePath.mockResolvedValue({
      repoType: 'git',
      rootPath: '/canonical/project',
    });
    const getOrCreate = vi.spyOn(workspaceModel, 'getOrCreate').mockResolvedValue({
      accessedAt: createdAt,
      createdAt,
      deviceId: 'device-a',
      displayName: 'project',
      env: null,
      envFiles: [],
      id: 'pws-project',
      kind: 'device',
      lastUsedAt: createdAt,
      repoType: 'git',
      rootPath: '/canonical/project',
      scan: null,
      scannedAt: null,
      scopeKey: 'device:device-a:/canonical/project',
      skillPolicy: null,
      updatedAt: createdAt,
      userId: 'user-a',
      workspaceId: null,
    });

    const workspace = await service.getOrCreate({
      deviceId: 'device-a',
      kind: 'device',
      rootPath: '/linked/project',
    });

    expect(getOrCreate).toHaveBeenCalledWith({
      deviceId: 'device-a',
      kind: 'device',
      repoType: 'git',
      rootPath: '/canonical/project',
    });
    expect(workspace.rootPath).toBe('/canonical/project');
  });

  it('uses the atomic first-writer-wins target capture seam for legacy migration', async () => {
    const { bindingStore, service } = createService();
    const captureTargetIfAbsent = vi.spyOn(bindingStore, 'captureTargetIfAbsent');

    await service.captureTargetIfAbsent({ target: 'local', topicId: 'topic-a' });

    expect(captureTargetIfAbsent).toHaveBeenCalledWith({ target: 'local', topicId: 'topic-a' });
  });

  it('keeps five plain-chat resolutions read-only and unbound', async () => {
    const { bindingStore, service, workspaceModel } = createService();
    const getState = vi.spyOn(bindingStore, 'getState');
    const getOrCreate = vi.spyOn(workspaceModel, 'getOrCreate');
    const bind = vi.spyOn(bindingStore, 'bind');

    const states = await Promise.all(
      Array.from({ length: 5 }, () => service.resolveTopic('topic-a')),
    );

    expect(states).toHaveLength(5);
    expect(states.every((state) => state?.workspace === undefined)).toBe(true);
    expect(getState).toHaveBeenCalledTimes(5);
    expect(getOrCreate).not.toHaveBeenCalled();
    expect(bind).not.toHaveBeenCalled();
  });

  it('creates scratch only through the explicit successful-tool seam', async () => {
    const { bindingStore, service, workspaceModel } = createService();
    const createdAt = new Date('2026-09-03T00:00:00.000Z');
    const getOrCreate = vi.spyOn(workspaceModel, 'getOrCreate').mockResolvedValue({
      accessedAt: createdAt,
      createdAt,
      deviceId: 'device-a',
      displayName: 'scratch-a',
      env: null,
      envFiles: [],
      id: 'pws-scratch',
      kind: 'scratch',
      lastUsedAt: createdAt,
      repoType: null,
      rootPath: '/tmp/scratch-a',
      scan: null,
      scannedAt: null,
      scopeKey: 'scratch:device-a:/tmp/scratch-a',
      skillPolicy: null,
      updatedAt: createdAt,
      userId: 'user-a',
      workspaceId: null,
    });
    const bind = vi.spyOn(bindingStore, 'bind').mockResolvedValue({
      decision: { allowed: true, reason: 'first-bind' },
      snapshot: { ...snapshot, workspaceId: 'pws-scratch', workspaceKind: 'scratch' },
      workspace: {
        deviceId: 'device-a',
        id: 'pws-scratch',
        kind: 'scratch',
        rootPath: '/tmp/scratch-a',
      },
    });

    await service.bindScratchAfterToolSuccess({
      deviceId: 'device-a',
      rootPath: '/tmp/scratch-a',
      toolSucceeded: true,
      topicId: 'topic-a',
    });

    expect(getOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'scratch', rootPath: '/tmp/scratch-a' }),
    );
    expect(bind).toHaveBeenCalledWith(
      expect.objectContaining({ topicId: 'topic-a', workspaceId: 'pws-scratch' }),
    );
  });

  it('preserves scratch catalog evidence when a concurrent formal bind wins', async () => {
    const { bindingStore, service, workspaceModel } = createService();
    const createdAt = new Date('2026-09-03T00:00:00.000Z');
    vi.spyOn(workspaceModel, 'getOrCreate').mockResolvedValue({
      accessedAt: createdAt,
      createdAt,
      deviceId: 'device-a',
      displayName: 'scratch-a',
      env: null,
      envFiles: [],
      id: 'pws-scratch',
      kind: 'scratch',
      lastUsedAt: createdAt,
      repoType: null,
      rootPath: '/tmp/scratch-a',
      scan: null,
      scannedAt: null,
      scopeKey: 'scratch:device-a:/tmp/scratch-a',
      skillPolicy: null,
      updatedAt: createdAt,
      userId: 'user-a',
      workspaceId: null,
    });
    vi.spyOn(bindingStore, 'bind').mockRejectedValue(new WorkspaceAlreadyBoundError());
    const deleteScratch = vi.spyOn(workspaceModel, 'deleteScratch').mockResolvedValue();

    const rejected = await service
      .bindScratchAfterToolSuccess({
        deviceId: 'device-a',
        rootPath: '/tmp/scratch-a',
        toolSucceeded: true,
        topicId: 'topic-a',
      })
      .catch((error) => error);

    expect(rejected).toBeInstanceOf(WorkspaceAlreadyBoundError);
    expect(rejected).toMatchObject({ scratchWorkspaceId: 'pws-scratch' });
    expect(deleteScratch).not.toHaveBeenCalled();
  });

  it('never exposes persisted environment values in list DTOs', async () => {
    const { service, workspaceModel } = createService();
    const createdAt = new Date('2026-09-03T00:00:00.000Z');
    vi.spyOn(workspaceModel, 'list').mockResolvedValue([
      {
        accessedAt: createdAt,
        createdAt,
        deviceId: 'device-a',
        displayName: 'project',
        env: { API_TOKEN: { secret: true, value: 'encrypted-value' } },
        envFiles: [],
        id: 'pws-project',
        kind: 'device',
        lastUsedAt: createdAt,
        repoType: 'git',
        rootPath: '/code/project',
        scan: null,
        scannedAt: null,
        scopeKey: 'device:device-a:/code/project',
        skillPolicy: null,
        updatedAt: createdAt,
        userId: 'user-a',
        workspaceId: null,
      },
    ]);

    const [item] = await service.list();

    expect(item).not.toHaveProperty('env');
    expect(item.envKeys).toEqual([{ key: 'API_TOKEN', secret: true }]);
    expect(JSON.stringify(item)).not.toContain('encrypted-value');
  });
});
