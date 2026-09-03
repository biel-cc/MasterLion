import type { TopicExecutionSnapshot } from '@lobechat/types/src/projectWorkspace';
import { describe, expect, it, vi } from 'vitest';

import { ProjectWorkspaceModel } from '@/database/models/projectWorkspace';

import type { TopicWorkspaceBindingStore } from './bindingStore';
import { ProjectWorkspaceService } from './index';

const snapshot: TopicExecutionSnapshot = {
  target: 'local',
  targetCapturedAt: '2026-09-03T00:00:00.000Z',
  version: 1,
};

const createService = () => {
  const workspaceModel = new ProjectWorkspaceModel({} as never, 'user-a');
  const bindingStore: TopicWorkspaceBindingStore = {
    bind: async () => {
      throw new Error('not implemented');
    },
    captureTarget: async () => snapshot,
    getState: async () => ({ snapshot }),
  };
  return {
    bindingStore,
    service: new ProjectWorkspaceService({ bindingStore, workspaceModel }),
    workspaceModel,
  };
};

describe('ProjectWorkspaceService', () => {
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
