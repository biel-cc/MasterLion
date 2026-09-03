import type {
  TopicExecutionSnapshot,
  TopicPlacement,
  TopicPlacementWorkspaceEvidence,
} from '../../../packages/types/src/projectWorkspace';

/**
 * The only Topic navigation classifier. It has no Task branch by design: recent is a derived
 * Topic list, while managed Tasks retain their independent lifecycle and storage.
 */
export const classifyTopicPlacement = (
  snapshot: TopicExecutionSnapshot | undefined,
  workspace: TopicPlacementWorkspaceEvidence | undefined,
): TopicPlacement => {
  if (!snapshot?.workspaceId) return { kind: 'recent', reason: 'unbound' };

  const workspaceKind =
    workspace?.id === snapshot.workspaceId ? workspace.kind : snapshot.workspaceKind;
  if (workspaceKind === 'scratch') return { kind: 'recent', reason: 'scratch' };

  if (workspaceKind === 'sandbox') {
    return workspace?.id === snapshot.workspaceId && workspace.hasProjectIdentity
      ? { kind: 'workspace', workspaceId: snapshot.workspaceId }
      : { kind: 'recent', reason: 'sandbox-without-project' };
  }

  if (workspaceKind === 'device') {
    return { kind: 'workspace', workspaceId: snapshot.workspaceId };
  }

  return { kind: 'recent', reason: 'unbound' };
};
