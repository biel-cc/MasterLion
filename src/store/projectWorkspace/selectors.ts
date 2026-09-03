import type { WorkspaceAccessGrant } from '@lobechat/types/src/executionContext';

import type { ProjectWorkspaceItem, TopicWorkspaceState } from '@/services/projectWorkspace';

import { buildTopicDeviceKey } from './draftKey';
import type { ProjectWorkspaceState, WorkspaceDraftIntent } from './initialState';

const EMPTY_GRANTS: WorkspaceAccessGrant[] = [];
const EMPTY_WORKSPACES: ProjectWorkspaceItem[] = [];

const getWorkspaceById =
  (workspaceId?: string | null) =>
  (s: ProjectWorkspaceState): ProjectWorkspaceItem | undefined =>
    workspaceId ? s.workspacesById[workspaceId] : undefined;

/** Formal device workspaces for one device. Scratch rows are never listed here. */
const getDeviceWorkspaces =
  (deviceId?: string | null) =>
  (s: ProjectWorkspaceState): ProjectWorkspaceItem[] => {
    if (!deviceId) return EMPTY_WORKSPACES;
    const ids = s.workspaceIdsByDevice[deviceId];
    if (!ids || ids.length === 0) return EMPTY_WORKSPACES;
    return ids
      .map((id) => s.workspacesById[id])
      .filter((item): item is ProjectWorkspaceItem => !!item && item.kind === 'device');
  };

const getTopicState =
  (topicId?: string | null) =>
  (s: ProjectWorkspaceState): TopicWorkspaceState | undefined =>
    topicId ? s.topicStatesById[topicId] : undefined;

const getDraftIntent =
  (key: string) =>
  (s: ProjectWorkspaceState): WorkspaceDraftIntent | undefined =>
    s.draftByConversationKey[key];

const getTopicGrants =
  (topicId?: string | null, deviceId?: string | null) =>
  (s: ProjectWorkspaceState): WorkspaceAccessGrant[] =>
    topicId && deviceId
      ? (s.grantsByTopicDevice[buildTopicDeviceKey(topicId, deviceId)] ?? EMPTY_GRANTS)
      : EMPTY_GRANTS;

const isSeamAvailable = (s: ProjectWorkspaceState): boolean => s.seamAvailable;
const lastError = (s: ProjectWorkspaceState) => s.lastError;
const pickerFocusNonce = (s: ProjectWorkspaceState): number => s.pickerFocusNonce;

export const projectWorkspaceSelectors = {
  getDeviceWorkspaces,
  getDraftIntent,
  getTopicGrants,
  getTopicState,
  getWorkspaceById,
  isSeamAvailable,
  lastError,
  pickerFocusNonce,
};
