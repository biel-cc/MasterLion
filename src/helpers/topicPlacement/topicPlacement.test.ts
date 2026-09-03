import type { TopicExecutionSnapshot } from '@lobechat/types/src/projectWorkspace';
import { describe, expect, it } from 'vitest';

import { classifyTopicPlacement } from './index';

const snapshot = (over: Partial<TopicExecutionSnapshot> = {}): TopicExecutionSnapshot => ({
  target: 'local',
  targetCapturedAt: '2026-09-03T00:00:00.000Z',
  version: 1,
  ...over,
});

describe('classifyTopicPlacement', () => {
  it('places an unbound topic only in recent', () => {
    expect(classifyTopicPlacement(snapshot(), undefined)).toEqual({
      kind: 'recent',
      reason: 'unbound',
    });
  });

  it('places a formal device workspace topic in exactly that workspace', () => {
    expect(
      classifyTopicPlacement(snapshot({ workspaceId: 'workspace-a', workspaceKind: 'device' }), {
        id: 'workspace-a',
        kind: 'device',
      }),
    ).toEqual({ kind: 'workspace', workspaceId: 'workspace-a' });
  });

  it('keeps scratch topics in recent even though they have a workspace id', () => {
    expect(
      classifyTopicPlacement(snapshot({ workspaceId: 'scratch-a', workspaceKind: 'scratch' }), {
        id: 'scratch-a',
        kind: 'scratch',
      }),
    ).toEqual({ kind: 'recent', reason: 'scratch' });
  });

  it('requires explicit project evidence before grouping a sandbox workspace', () => {
    const sandboxSnapshot = snapshot({
      target: 'sandbox',
      workspaceId: 'sandbox-a',
      workspaceKind: 'sandbox',
    });
    expect(classifyTopicPlacement(sandboxSnapshot, { id: 'sandbox-a', kind: 'sandbox' })).toEqual({
      kind: 'recent',
      reason: 'sandbox-without-project',
    });
    expect(
      classifyTopicPlacement(sandboxSnapshot, {
        hasProjectIdentity: true,
        id: 'sandbox-a',
        kind: 'sandbox',
      }),
    ).toEqual({ kind: 'workspace', workspaceId: 'sandbox-a' });
  });

  it('does not trust project evidence for another workspace id', () => {
    expect(
      classifyTopicPlacement(
        snapshot({
          target: 'sandbox',
          workspaceId: 'sandbox-a',
          workspaceKind: 'sandbox',
        }),
        { hasProjectIdentity: true, id: 'sandbox-b', kind: 'sandbox' },
      ),
    ).toEqual({ kind: 'recent', reason: 'sandbox-without-project' });
  });

  it('never projects any topic into the managed Task domain', () => {
    for (const placement of [
      classifyTopicPlacement(snapshot(), undefined),
      classifyTopicPlacement(snapshot({ workspaceId: 'workspace-a', workspaceKind: 'device' }), {
        id: 'workspace-a',
        kind: 'device',
      }),
      classifyTopicPlacement(snapshot({ workspaceId: 'scratch-a', workspaceKind: 'scratch' }), {
        id: 'scratch-a',
        kind: 'scratch',
      }),
    ]) {
      expect(placement.kind).toMatch(/^(recent|workspace)$/);
      expect(placement).not.toHaveProperty('taskId');
      expect(placement).not.toHaveProperty('task');
    }
  });
});
