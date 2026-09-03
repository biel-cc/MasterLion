import type {
  NormalizedWorkspaceIdentity,
  WorkspaceBindDecision,
  WorkspaceIdentity,
  WorkspaceRef,
} from '../../../packages/types/src/projectWorkspace';

/** Lexical filesystem-path check only; device-side realpath remains the security boundary. */
export const isAbsoluteFilesystemPath = (value: string): boolean => {
  const normalized = value.trim().replaceAll('\\', '/');
  return normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized);
};

/**
 * Canonical comparison form. This function intentionally does no filesystem IO and therefore
 * must not be used as a substitute for device-side realpath checks.
 */
export const normalizeRootPath = (value: string): string => {
  const withSlashes = value.trim().replaceAll('\\', '/');
  const collapsed = withSlashes.replace(/\/{2,}/g, '/');
  const driveNormalized = collapsed.replace(
    /^([A-Z]):\//,
    (_, drive: string) => `${drive.toLowerCase()}:/`,
  );

  if (driveNormalized === '/' || /^[a-z]:\/$/.test(driveNormalized)) return driveNormalized;
  return driveNormalized.replace(/\/+$/, '');
};

export const buildWorkspaceScopeKey = (identity: WorkspaceIdentity): string =>
  `${identity.kind}:${identity.deviceId ?? 'sandbox'}:${normalizeRootPath(identity.rootPath)}`;

export const normalizeWorkspaceIdentity = (
  workspace: WorkspaceRef,
): NormalizedWorkspaceIdentity => {
  const identity: WorkspaceIdentity = {
    deviceId: workspace.deviceId,
    kind: workspace.kind,
    rootPath: normalizeRootPath(workspace.rootPath),
  };

  return {
    ...identity,
    key: workspace.id ? `id:${workspace.id}` : buildWorkspaceScopeKey(identity),
    workspaceId: workspace.id,
  };
};

export const isSameWorkspace = (left: WorkspaceRef, right: WorkspaceRef): boolean => {
  if (left.id && right.id) return left.id === right.id;
  return buildWorkspaceScopeKey(left) === buildWorkspaceScopeKey(right);
};

export const decideWorkspaceBind = (
  current: WorkspaceRef | undefined,
  next: WorkspaceRef,
): WorkspaceBindDecision => {
  if (!current) return { allowed: true, reason: 'first-bind' };
  if (isSameWorkspace(current, next)) return { allowed: true, reason: 'same-workspace' };
  return { allowed: false, reason: 'already-bound' };
};
