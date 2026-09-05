// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DeviceGateway } from '@/server/services/deviceGateway';

import { projectWorkspaceRouter } from './projectWorkspace';

vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const { publicProcedure } = await import('@/libs/trpc/lambda');

  return { wsCompatProcedure: publicProcedure };
});

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: vi.fn((opts: any) => opts.next({ ctx: opts.ctx })),
}));

const workspaceRow = {
  accessedAt: new Date('2026-09-03T00:00:00.000Z'),
  createdAt: new Date('2026-09-03T00:00:00.000Z'),
  deviceId: 'device-a',
  displayName: 'project',
  env: null,
  envFiles: [],
  id: 'pws-project',
  kind: 'device' as const,
  lastUsedAt: new Date('2026-09-03T00:00:00.000Z'),
  repoType: 'git' as const,
  rootPath: '/canonical/project',
  scan: null,
  scannedAt: null,
  scopeKey: 'device:device-a:/canonical/project',
  skillPolicy: null,
  updatedAt: new Date('2026-09-03T00:00:00.000Z'),
  userId: 'user-a',
  workspaceId: null,
};

describe('projectWorkspaceRouter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['unconfirmed', 'wrong-device', 'missing-topic'])(
    'rejects %s local scratch evidence before creating a workspace',
    async (scenario) => {
      const evidence = vi
        .spyOn(DeviceGateway.prototype, 'getLocalScratchExecution')
        .mockResolvedValue(undefined);
      const insert = vi.fn();
      const metadata = {
        executionSnapshot: {
          version: 1,
          target: 'local',
          targetCapturedAt: '2026-09-05T00:00:00Z',
          boundDeviceId: 'device-a',
        },
      };
      const caller = projectWorkspaceRouter.createCaller({
        userId: 'user-a',
        serverDB: {
          insert,
          select: vi.fn(() => ({
            from: vi.fn(() => ({
              where: vi.fn(() => ({
                limit: vi
                  .fn()
                  .mockResolvedValue(scenario === 'missing-topic' ? [] : [{ metadata }]),
              })),
            })),
          })),
        },
      } as any);
      await expect(
        caller.finalizeLocalScratch({
          deviceId: scenario === 'wrong-device' ? 'device-other' : 'device-a',
          topicId: 'topic-a',
          operationId: 'op-a',
          toolCallId: 'call-a',
        }),
      ).rejects.toMatchObject({
        code:
          scenario === 'missing-topic'
            ? 'NOT_FOUND'
            : scenario === 'wrong-device'
              ? 'CONFLICT'
              : 'PRECONDITION_FAILED',
      });
      expect(insert).not.toHaveBeenCalled();
      if (scenario === 'unconfirmed')
        expect(evidence).toHaveBeenCalledWith({
          deviceId: 'device-a',
          topicId: 'topic-a',
          operationId: 'op-a',
          toolCallId: 'call-a',
          userId: 'user-a',
        });
      else expect(evidence).not.toHaveBeenCalled();
    },
  );

  it('uses target-device existence and realpath proof before get-or-create', async () => {
    const statPath = vi.spyOn(DeviceGateway.prototype, 'statPath').mockResolvedValue({
      exists: true,
      isDirectory: true,
      repoType: 'git',
    });
    const resolveRealPath = vi
      .spyOn(DeviceGateway.prototype, 'resolveRealPath')
      .mockResolvedValue('/canonical/project');
    let persisted: Record<string, unknown> | undefined;
    const serverDB = {
      insert: vi.fn(() => ({
        values: vi.fn((value: Record<string, unknown>) => {
          persisted = value;
          return {
            onConflictDoUpdate: vi.fn(() => ({
              returning: vi.fn(async () => [{ ...workspaceRow, ...value }]),
            })),
          };
        }),
      })),
    };
    const caller = projectWorkspaceRouter.createCaller({
      serverDB,
      userId: 'user-a',
    } as any);

    const workspace = await caller.getOrCreate({
      deviceId: 'device-a',
      rootPath: '/linked/project',
    });

    expect(resolveRealPath).toHaveBeenCalledWith({
      deviceId: 'device-a',
      path: '/linked/project',
      userId: 'user-a',
    });
    expect(statPath).toHaveBeenCalledWith({
      deviceId: 'device-a',
      path: '/canonical/project',
      userId: 'user-a',
    });
    expect(persisted).toEqual(
      expect.objectContaining({ repoType: 'git', rootPath: '/canonical/project' }),
    );
    expect(workspace.rootPath).toBe('/canonical/project');
  });

  it('rejects a nonexistent target-device directory without persisting it', async () => {
    const statPath = vi.spyOn(DeviceGateway.prototype, 'statPath');
    const resolveRealPath = vi
      .spyOn(DeviceGateway.prototype, 'resolveRealPath')
      .mockResolvedValue(undefined);
    const insert = vi.fn();
    const caller = projectWorkspaceRouter.createCaller({
      serverDB: { insert },
      userId: 'user-a',
    } as any);

    await expect(
      caller.getOrCreate({
        deviceId: 'device-a',
        rootPath: '/missing/project',
      }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: expect.stringContaining('does not exist or cannot be verified'),
    });

    expect(resolveRealPath).toHaveBeenCalledWith({
      deviceId: 'device-a',
      path: '/missing/project',
      userId: 'user-a',
    });
    expect(statPath).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('rejects a canonical target that is not a directory', async () => {
    vi.spyOn(DeviceGateway.prototype, 'resolveRealPath').mockResolvedValue('/canonical/file.txt');
    const statPath = vi.spyOn(DeviceGateway.prototype, 'statPath').mockResolvedValue({
      exists: true,
      isDirectory: false,
    });
    const insert = vi.fn();
    const caller = projectWorkspaceRouter.createCaller({
      serverDB: { insert },
      userId: 'user-a',
    } as any);

    await expect(
      caller.getOrCreate({
        deviceId: 'device-a',
        rootPath: '/linked/file.txt',
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

    expect(statPath).toHaveBeenCalledWith({
      deviceId: 'device-a',
      path: '/canonical/file.txt',
      userId: 'user-a',
    });
    expect(insert).not.toHaveBeenCalled();
  });
});
