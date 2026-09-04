import type {
  ExecutionAccessRoot,
  ExecutionContext,
  WorkspaceAccessGrant,
} from '@lobechat/types/src/executionContext';

import {
  resolveExecutionContext,
  type ResolveExecutionContextInput,
} from './resolveExecutionContext';

export interface ResolveFrozenClientExecutionContextInput extends ResolveExecutionContextInput {
  /** Persisted grants available to this renderer snapshot; mismatched or stale rows are ignored. */
  topicGrants?: readonly WorkspaceAccessGrant[];
  topicId?: string;
}

const toAccessRoot = (grant: WorkspaceAccessGrant): ExecutionAccessRoot => ({
  deviceId: grant.deviceId,
  expiresAt: grant.expiresAt,
  grantId: grant.id,
  modes: grant.modes,
  rootPath: grant.rootPath,
  scope: 'topic',
  source: 'user-approval',
  topicId: grant.topicId,
});

/**
 * Freeze the renderer-side execution plan and attach only grants whose full
 * topic/device evidence matches that plan. The device boundary revalidates the
 * same tuple; retaining it here prevents a valid grant from degrading into an
 * unauthenticated path root during IPC projection.
 */
export const resolveFrozenClientExecutionContext = (
  input: ResolveFrozenClientExecutionContextInput,
): ExecutionContext => {
  const preliminary = resolveExecutionContext(input);
  if (preliminary.plan.kind !== 'device' || !input.topicId) return preliminary;

  const now = Date.now();
  const deviceId = preliminary.plan.deviceId;
  const accessRoots = (input.topicGrants ?? [])
    .filter(
      (grant) =>
        grant.topicId === input.topicId &&
        grant.deviceId === deviceId &&
        !grant.revokedAt &&
        (!grant.expiresAt || new Date(grant.expiresAt).getTime() > now),
    )
    .map(toAccessRoot);

  return accessRoots.length > 0 ? resolveExecutionContext({ ...input, accessRoots }) : preliminary;
};
