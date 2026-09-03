import type { DeviceExecutionTarget } from '../agent/agencyConfig';

export * from './skillAdapter';

export type WorkspaceKind = 'device' | 'sandbox' | 'scratch';

/** Stable identity fields shared by persisted workspaces and legacy projections. */
export interface WorkspaceIdentity {
  /** Required for device and device-backed scratch workspaces. */
  deviceId?: string;
  kind: WorkspaceKind;
  /** Absolute path on the target device/container. */
  rootPath: string;
}

export interface WorkspaceRef extends WorkspaceIdentity {
  displayName?: string;
  /** project_workspaces.id; absent while projecting a legacy path. */
  id?: string;
}

/** Canonical comparison form used by bind-once and heterogeneous resume checks. */
export interface NormalizedWorkspaceIdentity extends WorkspaceIdentity {
  /** Persisted id plus normalized kind/device/path tuple, or only the tuple for legacy evidence. */
  key: string;
  workspaceId?: string;
}

/** Server-authored execution state for one topic. */
export interface TopicExecutionSnapshot {
  boundDeviceId?: string;
  target: DeviceExecutionTarget;
  targetCapturedAt: string;
  version: 1;
  workspaceBoundAt?: string;
  workspaceId?: string;
  workspaceKind?: WorkspaceKind;
}

/** Server-authored binding plus its resolved row, consumed together by bind-once decisions. */
export interface WorkspaceBindingEvidence {
  snapshot?: Pick<TopicExecutionSnapshot, 'workspaceId' | 'workspaceKind'>;
  workspace?: WorkspaceRef;
}

/** Defaults for future topics. These values are deliberately platform-isolated. */
export interface ExecutionTargetByPlatform {
  desktop?: DeviceExecutionTarget;
  web?: DeviceExecutionTarget;
}

/**
 * One-shot client intent used only while a topic has no server-authored
 * execution snapshot. The server validates the referenced workspace and
 * writes the snapshot in the same topic create operation; this object is not
 * execution authority by itself.
 */
export interface TopicExecutionIntent {
  /** The real renderer platform. The server must not infer this from gateway availability. */
  platform: 'desktop' | 'web';
  /** Effective target selected for this topic draft / legacy-topic migration. */
  target: DeviceExecutionTarget;
  /** Explicit selected device, or the Electron installation's own device id for `local`. */
  targetDeviceId?: string;
  /** Explicit draft workspace choice. Existing topics ignore this field. */
  workspaceId?: string;
}

export type TopicPlacement =
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'recent'; reason: 'sandbox-without-project' | 'scratch' | 'unbound' };

/**
 * Server-derived evidence needed by the placement classifier. `hasProjectIdentity`
 * represents explicit repository/project evidence, never a client-writable placement flag.
 */
export interface TopicPlacementWorkspaceEvidence {
  hasProjectIdentity?: boolean;
  id: string;
  kind: WorkspaceKind;
}

export type WorkspaceBindDecision =
  | { allowed: true; reason: 'first-bind' | 'same-workspace' }
  | { allowed: false; reason: 'already-bound' };

export interface ProjectWorkspaceEnvEntry {
  secret: boolean;
  /** Encrypted at rest; plaintext exists only inside the execution-env adapter. */
  value: string;
}

export type ProjectWorkspaceEnvRecord = Record<string, ProjectWorkspaceEnvEntry>;
