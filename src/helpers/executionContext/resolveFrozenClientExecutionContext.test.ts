import { describe, expect, it } from 'vitest';

import { resolveFrozenClientExecutionContext } from './resolveFrozenClientExecutionContext';

const workspace = {
  deviceId: 'device-1',
  id: 'workspace-1',
  kind: 'device' as const,
  rootPath: '/repo',
};

describe('resolveFrozenClientExecutionContext', () => {
  it('preserves the complete topic-grant evidence for the device boundary', () => {
    const context = resolveFrozenClientExecutionContext({
      agencyConfig: { executionTargetByPlatform: { desktop: 'local' } },
      initialTopicMetadata: { workspaceId: workspace.id },
      isDesktop: true,
      operationId: 'operation-1',
      requestedDeviceId: 'device-1',
      topicGrants: [
        {
          createdAt: '2026-01-01T00:00:00.000Z',
          deviceId: 'device-1',
          expiresAt: '2099-01-01T00:00:00.000Z',
          id: 'grant-1',
          modes: ['read'],
          requestedVia: {},
          rootPath: '/outside',
          scope: 'topic',
          topicId: 'topic-1',
          userId: 'user-1',
        },
      ],
      topicId: 'topic-1',
      workspaces: { [workspace.id]: workspace },
    });

    expect(context.accessRoots).toEqual([
      {
        modes: ['read', 'write', 'exec'],
        rootPath: '/repo',
        scope: 'primary',
        source: 'workspace',
      },
      {
        deviceId: 'device-1',
        expiresAt: '2099-01-01T00:00:00.000Z',
        grantId: 'grant-1',
        modes: ['read'],
        rootPath: '/outside',
        scope: 'topic',
        source: 'user-approval',
        topicId: 'topic-1',
      },
    ]);
  });

  it('drops revoked, expired, cross-topic and cross-device grants', () => {
    const baseGrant = {
      createdAt: '2026-01-01T00:00:00.000Z',
      deviceId: 'device-1',
      id: 'grant',
      modes: ['read'] as Array<'read' | 'write' | 'exec'>,
      requestedVia: {},
      rootPath: '/outside',
      scope: 'topic' as const,
      topicId: 'topic-1',
      userId: 'user-1',
    };
    const context = resolveFrozenClientExecutionContext({
      agencyConfig: { executionTargetByPlatform: { desktop: 'local' } },
      initialTopicMetadata: { workspaceId: workspace.id },
      isDesktop: true,
      requestedDeviceId: 'device-1',
      topicGrants: [
        { ...baseGrant, expiresAt: '2000-01-01T00:00:00.000Z', id: 'expired' },
        { ...baseGrant, id: 'revoked', revokedAt: '2026-01-02T00:00:00.000Z' },
        { ...baseGrant, id: 'other-topic', topicId: 'topic-2' },
        { ...baseGrant, deviceId: 'device-2', id: 'other-device' },
      ],
      topicId: 'topic-1',
      workspaces: { [workspace.id]: workspace },
    });

    expect(context.accessRoots).toHaveLength(1);
    expect(context.accessRoots?.[0]).toMatchObject({ rootPath: '/repo', scope: 'primary' });
  });
});
