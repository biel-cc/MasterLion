import { describe, expect, it, vi } from 'vitest';

import { TopicModel } from '@/database/models/topic';
import { WorkspaceAccessGrantModel } from '@/database/models/workspaceAccessGrant';
import type { WorkspaceAccessGrantRow } from '@/database/schemas/workspaceAccessGrant';

import { EXEC_GRANT_TTL_MS, WorkspaceAccessGrantService } from './index';

const now = new Date('2026-09-03T00:00:00.000Z');

const grantRow = (overrides: Partial<WorkspaceAccessGrantRow> = {}): WorkspaceAccessGrantRow => ({
  accessedAt: now,
  createdAt: now,
  deviceId: 'device-a',
  expiresAt: null,
  id: 'grant-a',
  lastUsedAt: null,
  modes: ['read'],
  requestedVia: {},
  revokedAt: null,
  rootPath: '/code/shared',
  scope: 'topic',
  topicId: 'topic-a',
  updatedAt: now,
  userId: 'user-a',
  ...overrides,
});

const createService = (
  topic: { id: string; status: null | string } | undefined = {
    id: 'topic-a',
    status: null,
  },
) => {
  const grantModel = new WorkspaceAccessGrantModel({} as never, 'user-a');
  const topicModel = new TopicModel({} as never, 'user-a');
  vi.spyOn(topicModel, 'findById').mockResolvedValue(topic as never);
  const service = new WorkspaceAccessGrantService({ clock: () => now, grantModel, topicModel });
  return { grantModel, service };
};

describe('WorkspaceAccessGrantService', () => {
  it('defaults exec grants to exactly one hour and expires at the boundary', async () => {
    const { grantModel, service } = createService();
    const upsert = vi
      .spyOn(grantModel, 'upsert')
      .mockImplementation(async (params) =>
        grantRow({ expiresAt: params.expiresAt, modes: params.modes }),
      );

    const grant = await service.grant({
      deviceId: 'device-a',
      modes: ['exec'],
      rootPath: '/code/shared',
      topicId: 'topic-a',
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ expiresAt: new Date(now.getTime() + EXEC_GRANT_TTL_MS) }),
      now,
    );
    expect(grant.expiresAt).toBe('2026-09-03T01:00:00.000Z');

    const listActive = vi.spyOn(grantModel, 'listActive').mockResolvedValue([]);
    const boundaryService = new WorkspaceAccessGrantService({
      clock: () => new Date(now.getTime() + EXEC_GRANT_TTL_MS),
      grantModel,
      topicModel: new TopicModel({} as never, 'user-a'),
    });
    await boundaryService.listActive({ deviceId: 'device-a', topicId: 'topic-a' });
    expect(listActive).toHaveBeenCalledWith(
      { deviceId: 'device-a', topicId: 'topic-a' },
      new Date(now.getTime() + EXEC_GRANT_TTL_MS),
    );
  });

  it('passes the exact topic/device tuple to active lookup and access-root projection', async () => {
    const { grantModel, service } = createService();
    const listActive = vi
      .spyOn(grantModel, 'listActive')
      .mockResolvedValue([grantRow({ modes: ['read', 'write'] })]);

    const roots = await service.buildAccessRoots({ deviceId: 'device-a', topicId: 'topic-a' });

    expect(listActive).toHaveBeenCalledWith({ deviceId: 'device-a', topicId: 'topic-a' }, now);
    expect(roots).toEqual([
      {
        deviceId: 'device-a',
        expiresAt: undefined,
        grantId: 'grant-a',
        modes: ['read', 'write'],
        rootPath: '/code/shared',
        scope: 'topic',
        source: 'user-approval',
        topicId: 'topic-a',
      },
    ]);
  });

  it('refuses archived topics before writing a grant', async () => {
    const { grantModel, service } = createService({ id: 'topic-a', status: 'archived' });
    const upsert = vi.spyOn(grantModel, 'upsert');

    await expect(
      service.grant({
        deviceId: 'device-a',
        modes: ['read'],
        rootPath: '/code/shared',
        topicId: 'topic-a',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('rejects permanent or overlong exec grants', async () => {
    const { grantModel, service } = createService();
    const upsert = vi.spyOn(grantModel, 'upsert');

    await expect(
      service.grant({
        deviceId: 'device-a',
        expiresAt: new Date(now.getTime() + EXEC_GRANT_TTL_MS + 1),
        modes: ['exec'],
        rootPath: '/code/shared',
        topicId: 'topic-a',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(upsert).not.toHaveBeenCalled();
  });
});
