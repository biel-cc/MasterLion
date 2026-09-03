import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createProjectWorkspaceService,
  type ProjectWorkspaceClient,
  type ProjectWorkspaceItem,
  WorkspaceAlreadyBoundError,
} from '@/services/projectWorkspace';

import { buildDraftConversationKey } from './draftKey';
import { createProjectWorkspaceStore } from './store';

const deviceWorkspace: ProjectWorkspaceItem = {
  deviceId: 'device-1',
  id: 'ws-project',
  kind: 'device',
  rootPath: '/projects/app',
};

const scratchWorkspace: ProjectWorkspaceItem = {
  deviceId: 'device-1',
  id: 'ws-scratch',
  kind: 'scratch',
  rootPath: '/tmp/scratch/topic-1',
};

const createClient = (): { [K in keyof ProjectWorkspaceClient]: ReturnType<typeof vi.fn> } => ({
  bindTopic: vi.fn(),
  captureTarget: vi.fn(),
  getOrCreate: vi.fn(),
  getTopicState: vi.fn(),
  grant: vi.fn(),
  list: vi.fn(),
  listGrants: vi.fn(),
  revoke: vi.fn(),
});

describe('projectWorkspace store actions', () => {
  let client: ReturnType<typeof createClient>;
  let store: ReturnType<typeof createProjectWorkspaceStore>;

  beforeEach(() => {
    client = createClient();
    store = createProjectWorkspaceStore(
      createProjectWorkspaceService(client as unknown as ProjectWorkspaceClient),
    );
  });

  describe('draft intent', () => {
    it('writes the draft only and never calls the router', () => {
      const key = buildDraftConversationKey({ agentId: 'agent-a' });
      store.getState().setDraftWorkspaceIntent(key, {
        target: 'local',
        targetDeviceId: 'device-1',
        workspaceId: 'ws-project',
      });

      expect(store.getState().draftByConversationKey[key]).toMatchObject({
        target: 'local',
        targetDeviceId: 'device-1',
        workspaceId: 'ws-project',
      });
      for (const fn of Object.values(client)) expect(fn).not.toHaveBeenCalled();
    });

    it('isolates drafts between agents and groups', () => {
      const keyA = buildDraftConversationKey({ agentId: 'agent-a' });
      const keyAInGroup = buildDraftConversationKey({ agentId: 'agent-a', groupId: 'group-1' });
      store.getState().setDraftWorkspaceIntent(keyA, { workspaceId: 'ws-project' });

      expect(store.getState().draftByConversationKey[keyAInGroup]).toBeUndefined();
      expect(store.getState().draftByConversationKey[keyA]?.workspaceId).toBe('ws-project');
    });

    it('merges target intent without dropping the workspace selection', () => {
      const key = buildDraftConversationKey({ agentId: 'agent-a' });
      store.getState().setDraftWorkspaceIntent(key, { workspaceId: 'ws-project' });
      store.getState().setDraftTargetIntent(key, { target: 'device', targetDeviceId: 'device-2' });

      expect(store.getState().draftByConversationKey[key]).toMatchObject({
        target: 'device',
        targetDeviceId: 'device-2',
        workspaceId: 'ws-project',
      });
    });

    it('consumeDraftIntent returns and clears the draft', () => {
      const key = buildDraftConversationKey({ agentId: 'agent-a' });
      store.getState().setDraftWorkspaceIntent(key, { workspaceId: 'ws-project' });

      expect(store.getState().consumeDraftIntent(key)?.workspaceId).toBe('ws-project');
      expect(store.getState().draftByConversationKey[key]).toBeUndefined();
      expect(store.getState().consumeDraftIntent(key)).toBeUndefined();
    });
  });

  describe('getOrCreateDeviceWorkspace', () => {
    it('upserts the returned row and indexes it by device', async () => {
      client.getOrCreate.mockResolvedValue(deviceWorkspace);

      const outcome = await store
        .getState()
        .getOrCreateDeviceWorkspace({ deviceId: 'device-1', rootPath: '/projects/app' });

      expect(outcome).toEqual({ ok: true, value: deviceWorkspace });
      expect(store.getState().workspacesById['ws-project']).toEqual(deviceWorkspace);
      expect(store.getState().workspaceIdsByDevice['device-1']).toEqual(['ws-project']);
    });

    it('reports SEAM_UNAVAILABLE without throwing when the router is not wired', async () => {
      const unwired = createProjectWorkspaceStore(createProjectWorkspaceService(undefined));
      const outcome = await unwired
        .getState()
        .getOrCreateDeviceWorkspace({ deviceId: 'device-1', rootPath: '/projects/app' });

      expect(outcome).toMatchObject({ code: 'SEAM_UNAVAILABLE', ok: false });
      expect(unwired.getState().seamAvailable).toBe(false);
      expect(unwired.getState().lastError?.code).toBe('SEAM_UNAVAILABLE');
    });
  });

  describe('bindTopicWorkspace', () => {
    it('binds an unbound topic through the router and stores the returned state', async () => {
      const snapshot = {
        boundDeviceId: 'device-1',
        target: 'local' as const,
        targetCapturedAt: 'now',
        version: 1 as const,
        workspaceId: 'ws-project',
        workspaceKind: 'device' as const,
      };
      client.bindTopic.mockResolvedValue({
        decision: { allowed: true, reason: 'first-bind' },
        snapshot,
        workspace: deviceWorkspace,
      });
      store.getState().upsertWorkspaces([deviceWorkspace]);
      store.getState().setTopicState('topic-1', {
        snapshot: { ...snapshot, workspaceId: undefined, workspaceKind: undefined },
      });

      const outcome = await store
        .getState()
        .bindTopicWorkspace({ target: 'local', topicId: 'topic-1', workspaceId: 'ws-project' });

      expect(outcome.ok).toBe(true);
      expect(client.bindTopic).toHaveBeenCalledWith({
        target: 'local',
        topicId: 'topic-1',
        workspaceId: 'ws-project',
      });
      expect(store.getState().topicStatesById['topic-1']?.snapshot?.workspaceId).toBe('ws-project');
    });

    it('rejects scratch → project in place locally without a router call', async () => {
      store.getState().upsertWorkspaces([deviceWorkspace, scratchWorkspace]);
      store.getState().setTopicState('topic-1', {
        snapshot: {
          target: 'local',
          targetCapturedAt: 'now',
          version: 1,
          workspaceId: 'ws-scratch',
          workspaceKind: 'scratch',
        },
        workspace: { ...scratchWorkspace },
      });

      const outcome = await store
        .getState()
        .bindTopicWorkspace({ topicId: 'topic-1', workspaceId: 'ws-project' });

      expect(outcome).toEqual({ code: 'WORKSPACE_ALREADY_BOUND', ok: false });
      expect(client.bindTopic).not.toHaveBeenCalled();
      expect(store.getState().topicStatesById['topic-1']?.snapshot?.workspaceId).toBe('ws-scratch');
    });

    it('surfaces the server bind-once rejection as WORKSPACE_ALREADY_BOUND and keeps the old cwd', async () => {
      client.bindTopic.mockRejectedValue(new WorkspaceAlreadyBoundError());
      store.getState().setTopicState('topic-1', {
        snapshot: {
          target: 'local',
          targetCapturedAt: 'now',
          version: 1,
          workspaceId: 'ws-other',
          workspaceKind: 'device',
        },
      });

      const outcome = await store
        .getState()
        .bindTopicWorkspace({ topicId: 'topic-1', workspaceId: 'ws-project' });

      expect(outcome).toMatchObject({ code: 'WORKSPACE_ALREADY_BOUND', ok: false });
      expect(store.getState().topicStatesById['topic-1']?.snapshot?.workspaceId).toBe('ws-other');
    });

    it('maps a raw tRPC FORBIDDEN message to WORKSPACE_ALREADY_BOUND', async () => {
      client.bindTopic.mockRejectedValue(new Error('WORKSPACE_ALREADY_BOUND'));

      const outcome = await store
        .getState()
        .bindTopicWorkspace({ topicId: 'topic-1', workspaceId: 'ws-project' });

      expect(outcome).toMatchObject({ code: 'WORKSPACE_ALREADY_BOUND', ok: false });
    });
  });

  describe('captureTopicTarget', () => {
    it('writes the server snapshot into topic state and never touches drafts', async () => {
      client.captureTarget.mockResolvedValue({
        boundDeviceId: 'device-2',
        target: 'device',
        targetCapturedAt: 'now',
        version: 1,
      });

      const outcome = await store
        .getState()
        .captureTopicTarget({ boundDeviceId: 'device-2', target: 'device', topicId: 'topic-1' });

      expect(outcome.ok).toBe(true);
      expect(store.getState().topicStatesById['topic-1']?.snapshot?.boundDeviceId).toBe('device-2');
      expect(store.getState().draftByConversationKey).toEqual({});
    });
  });

  describe('grantTopicAccess', () => {
    it('stores an acknowledged grant under the topic/device key', async () => {
      const grant = {
        createdAt: 'now',
        deviceId: 'device-1',
        id: 'wag_1',
        modes: ['read' as const],
        requestedVia: {},
        rootPath: '/data/reports',
        scope: 'topic' as const,
        topicId: 'topic-1',
        userId: 'user-1',
      };
      client.grant.mockResolvedValue(grant);

      const outcome = await store.getState().grantTopicAccess({
        deviceId: 'device-1',
        modes: ['read'],
        rootPath: '/data/reports',
        topicId: 'topic-1',
      });

      expect(outcome).toEqual({ ok: true, value: grant });
      expect(store.getState().grantsByTopicDevice['topic-1::device-1']).toEqual([grant]);
    });

    it('does not report success when the seam is unavailable', async () => {
      const unwired = createProjectWorkspaceStore(createProjectWorkspaceService(undefined));

      const outcome = await unwired.getState().grantTopicAccess({
        deviceId: 'device-1',
        modes: ['write'],
        rootPath: '/data/reports',
        topicId: 'topic-1',
      });

      expect(outcome).toMatchObject({ code: 'SEAM_UNAVAILABLE', ok: false });
      expect(unwired.getState().grantsByTopicDevice).toEqual({});
    });
  });

  it('focusWorkspacePicker bumps the nonce', () => {
    store.getState().focusWorkspacePicker();
    store.getState().focusWorkspacePicker();
    expect(store.getState().pickerFocusNonce).toBe(2);
  });
});
