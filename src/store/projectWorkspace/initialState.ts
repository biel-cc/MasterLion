import type { DeviceExecutionTarget } from '@lobechat/types/src/agent/agencyConfig';
import type { PathAccessMode, WorkspaceAccessGrant } from '@lobechat/types/src/executionContext';

import type { ProjectWorkspaceItem, TopicWorkspaceState } from '@/services/projectWorkspace';

/**
 * Client-only intent for a topic that does not exist yet. It is never a
 * binding: the server binds once at topic creation (integrate wiring reads it
 * via `consumeDraftIntent`). Recommendations never populate this record.
 */
export interface WorkspaceDraftIntent {
  /** Old-server fallback only; never represents a formal binding. */
  legacyWorkingDirectory?: string;
  /** Topic referenced by "start a new topic in this directory". */
  referenceTopicId?: string;
  /** Header new-topic flow permits changing target and directory until first send. */
  runtimeEditable?: boolean;
  target?: DeviceExecutionTarget;
  targetDeviceId?: string;
  updatedAt: number;
  /** Explicit user selection for this draft only. */
  workspaceId?: string;
}

/**
 * Operation-scoped path consent produced by the intervention UI. It is never
 * persisted: integrate wiring reads it when it rebuilds the operation
 * `accessRoots`, and a rejection is recorded so the panel can stay consistent.
 */
export interface PathConsentDecision {
  actualCwd: string;
  at: number;
  deviceId: string;
  modes: PathAccessMode[];
  operationId: string;
  primaryCwd: string;
  requestedPath: string;
  rootPath: string;
  scope: 'operation' | 'reject' | 'topic';
  topicId: string;
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
  /**
   * Keyed by tool message id. These are UI decisions awaiting device proof and
   * operation resume; acknowledged topic grants alone live in `grantsByTopicDevice`.
   */
  operationConsentByMessage: Record<string, PathConsentDecision>;
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
  operationConsentByMessage: {},
  pickerFocusNonce: 0,
  seamAvailable: false,
  topicStatesById: {},
  workspaceIdsByDevice: {},
  workspacesById: {},
};
