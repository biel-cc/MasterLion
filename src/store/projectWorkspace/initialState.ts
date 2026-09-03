import type { DeviceExecutionTarget } from '@lobechat/types/src/agent/agencyConfig';
import type { WorkspaceAccessGrant } from '@lobechat/types/src/executionContext';

import type { ProjectWorkspaceItem, TopicWorkspaceState } from '@/services/projectWorkspace';

/**
 * Client-only intent for a topic that does not exist yet. It is never a
 * binding: the server binds once at topic creation (integrate wiring reads it
 * via `consumeDraftIntent`). Recommendations never populate this record.
 */
export interface WorkspaceDraftIntent {
  /** Topic referenced by "start a new topic in this directory". */
  referenceTopicId?: string;
  target?: DeviceExecutionTarget;
  targetDeviceId?: string;
  updatedAt: number;
  /** Explicit user selection for this draft only. */
  workspaceId?: string;
}

export type ProjectWorkspaceErrorCode =
  | 'SEAM_UNAVAILABLE'
  | 'UNKNOWN'
  | 'WORKSPACE_ALREADY_BOUND'
  | 'WORKSPACE_NOT_FOUND';

export interface ProjectWorkspaceUiError {
  at: number;
  code: ProjectWorkspaceErrorCode;
  message?: string;
  topicId?: string;
}

export type ProjectWorkspaceOutcome<T> =
  | { ok: true; value: T }
  | { code: ProjectWorkspaceErrorCode; message?: string; ok: false };

export interface ProjectWorkspaceState {
  draftByConversationKey: Record<string, WorkspaceDraftIntent>;
  /** Keyed by `buildTopicDeviceKey(topicId, deviceId)`. */
  grantsByTopicDevice: Record<string, WorkspaceAccessGrant[]>;
  isWorkspacesInit: boolean;
  lastError?: ProjectWorkspaceUiError;
  /** Incremented when a consumer asks the workspace picker to take focus. */
  pickerFocusNonce: number;
  /** Whether the A1 router seam is reachable from this client build. */
  seamAvailable: boolean;
  topicStatesById: Record<string, TopicWorkspaceState>;
  workspaceIdsByDevice: Record<string, string[]>;
  workspacesById: Record<string, ProjectWorkspaceItem>;
}

export const initialState: ProjectWorkspaceState = {
  draftByConversationKey: {},
  grantsByTopicDevice: {},
  isWorkspacesInit: false,
  pickerFocusNonce: 0,
  seamAvailable: false,
  topicStatesById: {},
  workspaceIdsByDevice: {},
  workspacesById: {},
};
