import { describe, expect, it } from 'vitest';

import { initialState, type ProjectWorkspaceState } from './initialState';
import { projectWorkspaceSelectors } from './selectors';

const state: ProjectWorkspaceState = {
  ...initialState,
  draftByConversationKey: { 'draft::agent-a': { updatedAt: 1, workspaceId: 'ws-a' } },
  grantsByTopicDevice: {
    'topic-1::device-1': [
      {
        createdAt: 'now',
        deviceId: 'device-1',
        id: 'wag_1',
        modes: ['read'],
        requestedVia: {},
        rootPath: '/data',
        scope: 'topic',
        topicId: 'topic-1',
        userId: 'u',
      },
    ],
  },
  topicStatesById: {
    'topic-1': {
      snapshot: { target: 'local', targetCapturedAt: '', version: 1, workspaceId: 'ws-a' },
    },
  },
  workspaceIdsByDevice: { 'device-1': ['ws-a', 'ws-scratch', 'missing'] },
  workspacesById: {
    'ws-a': { deviceId: 'device-1', id: 'ws-a', kind: 'device', rootPath: '/projects/a' },
    'ws-scratch': { deviceId: 'device-1', id: 'ws-scratch', kind: 'scratch', rootPath: '/tmp/s' },
  },
};

describe('projectWorkspaceSelectors', () => {
  it('lists only formal device workspaces for a device', () => {
    expect(projectWorkspaceSelectors.getDeviceWorkspaces('device-1')(state).map((w) => w.id)).toEqual([
      'ws-a',
    ]);
    expect(projectWorkspaceSelectors.getDeviceWorkspaces(undefined)(state)).toEqual([]);
  });

  it('returns the same empty array reference for unknown devices', () => {
    expect(projectWorkspaceSelectors.getDeviceWorkspaces('device-x')(state)).toBe(
      projectWorkspaceSelectors.getDeviceWorkspaces('device-y')(state),
    );
  });

  it('reads topic state, drafts and grants by key', () => {
    expect(projectWorkspaceSelectors.getTopicState('topic-1')(state)?.snapshot?.workspaceId).toBe(
      'ws-a',
    );
    expect(projectWorkspaceSelectors.getTopicState(null)(state)).toBeUndefined();
    expect(projectWorkspaceSelectors.getDraftIntent('draft::agent-a')(state)?.workspaceId).toBe('ws-a');
    expect(projectWorkspaceSelectors.getTopicGrants('topic-1', 'device-1')(state)).toHaveLength(1);
    expect(projectWorkspaceSelectors.getTopicGrants('topic-1', 'device-2')(state)).toEqual([]);
  });
});
