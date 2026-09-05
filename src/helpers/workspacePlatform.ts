import type { WorkspaceDraftIntent } from '@/store/projectWorkspace/initialState';

/** Normalize new drafts only. Persisted topic identity is never rewritten by a client. */
export function normalizeNewTopicIntent<T extends Partial<WorkspaceDraftIntent>>(
  intent: T,
  desktop: boolean,
): Omit<
  T,
  'target' | 'runtimeEditable' | 'workspaceId' | 'legacyWorkingDirectory' | 'targetDeviceId'
> &
  Partial<WorkspaceDraftIntent> {
  if (desktop) return intent;
  return {
    ...intent,
    legacyWorkingDirectory: undefined,
    runtimeEditable: false,
    target: intent.target === 'local' ? 'none' : intent.target,
    targetDeviceId: intent.target === 'device' ? intent.targetDeviceId : undefined,
    workspaceId: undefined,
  };
}
