import { describe, expect, it, vi } from 'vitest';

import { resolveTopicCreationExecutionMetadata } from './topicExecutionIntent';

const now = new Date('2026-09-04T00:00:00.000Z');

describe('resolveTopicCreationExecutionMetadata', () => {
  it('keeps old clients compatible when no intent is supplied', async () => {
    const metadata = { workingDirectory: '/legacy' };
    await expect(
      resolveTopicCreationExecutionMetadata({
        metadata,
        workspaceModel: {} as never,
      }),
    ).resolves.toBe(metadata);
  });

  it('atomically freezes a validated local workspace and canonical mirrors', async () => {
    const workspaceModel = {
      findById: vi.fn().mockResolvedValue({
        deviceId: 'device-a',
        displayName: 'repo',
        id: 'workspace-a',
        kind: 'project',
        rootPath: '/repo',
      }),
    };

    await expect(
      resolveTopicCreationExecutionMetadata({
        intent: {
          platform: 'desktop',
          target: 'local',
          targetDeviceId: 'device-a',
          workspaceId: 'workspace-a',
        },
        metadata: { workingDirectory: '/browser-value' },
        now,
        workspaceModel: workspaceModel as never,
      }),
    ).resolves.toMatchObject({
      boundDeviceId: 'device-a',
      executionSnapshot: {
        boundDeviceId: 'device-a',
        target: 'local',
        targetCapturedAt: now.toISOString(),
        version: 1,
        workspaceBoundAt: now.toISOString(),
        workspaceId: 'workspace-a',
        workspaceKind: 'project',
      },
      workingDirectory: '/repo',
      workspaceId: 'workspace-a',
      workspaceKind: 'project',
    });
  });

  it('creates the canonical sandbox workspace and freezes it on first insert', async () => {
    const getOrCreate = vi.fn().mockResolvedValue({
      id: 'sandbox-a',
      kind: 'sandbox',
      rootPath: '/workspace',
    });

    const result = await resolveTopicCreationExecutionMetadata({
      intent: { platform: 'web', target: 'sandbox' },
      now,
      organizationWorkspaceId: 'org-a',
      workspaceModel: { getOrCreate } as never,
    });

    expect(getOrCreate).toHaveBeenCalledWith({
      kind: 'sandbox',
      rootPath: '/workspace',
      workspaceId: 'org-a',
    });
    expect(result).toMatchObject({
      executionSnapshot: { target: 'sandbox', workspaceId: 'sandbox-a' },
      workspaceId: 'sandbox-a',
      workspaceKind: 'sandbox',
    });
    expect(result).not.toHaveProperty('workingDirectory');
  });

  it('never trusts legacy cwd mirrors for a target-only intent', async () => {
    const result = await resolveTopicCreationExecutionMetadata({
      intent: { platform: 'desktop', target: 'local', targetDeviceId: 'device-a' },
      metadata: { boundDeviceId: 'browser-device', workingDirectory: '/browser-value' },
      now,
      workspaceModel: {} as never,
    });

    expect(result).toMatchObject({
      executionSnapshot: { boundDeviceId: 'device-a', target: 'local' },
    });
    expect(result).not.toHaveProperty('boundDeviceId');
    expect(result).not.toHaveProperty('workingDirectory');
  });

  it('rejects a web client claiming the Electron-only local target', async () => {
    await expect(
      resolveTopicCreationExecutionMetadata({
        intent: { platform: 'web', target: 'local', targetDeviceId: 'device-a' },
        workspaceModel: {} as never,
      }),
    ).rejects.toThrow(/web client/);
  });

  it('rejects a device binding on a non-device target', async () => {
    await expect(
      resolveTopicCreationExecutionMetadata({
        intent: { platform: 'web', target: 'sandbox', targetDeviceId: 'device-a' },
        workspaceModel: {} as never,
      }),
    ).rejects.toThrow(/cannot bind a device/);
  });

  it('fails closed when the selected workspace belongs to another device', async () => {
    await expect(
      resolveTopicCreationExecutionMetadata({
        intent: {
          platform: 'desktop',
          target: 'device',
          targetDeviceId: 'device-b',
          workspaceId: 'workspace-a',
        },
        workspaceModel: {
          findById: vi.fn().mockResolvedValue({
            deviceId: 'device-a',
            id: 'workspace-a',
            kind: 'project',
            rootPath: '/repo',
          }),
        } as never,
      }),
    ).rejects.toThrow(/does not own/);
  });
});
