import { useCallback, useMemo, useState } from 'react';

import type { EffectiveWorkspace } from '@/hooks/useEffectiveWorkspace';
import { useChatStore } from '@/store/chat';
import { useDeviceStore } from '@/store/device';
import { type ProjectWorkspaceErrorCode, useProjectWorkspaceStore } from '@/store/projectWorkspace';

import { selectWorkspaceOnce, type WorkspaceSelection } from './workspaceBindingActions';

export type { WorkspaceSelection } from './workspaceBindingActions';

export interface BindWorkspaceError {
  code: ProjectWorkspaceErrorCode;
  message?: string;
}

/**
 * Bind-once write path for the workspace picker.
 *
 * - draft (no topic yet): only the draft intent is written; topic creation
 *   reads it via `consumeDraftIntent` (integrate seam) and binds atomically.
 * - existing unbound topic: `getOrCreate` the formal device workspace, then
 *   call the bind-once API. `WORKSPACE_ALREADY_BOUND` keeps the current cwd.
 * - bound / scratch topics are never rebound in place: the only way to change
 *   directory is `startReferencedTopic`, which opens a new draft that
 *   references the current topic.
 *
 * Nothing here touches agent defaults, agency config or device defaults.
 */
export const useBindWorkspaceOnce = (effective: EffectiveWorkspace) => {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<BindWorkspaceError>();

  const getOrCreateDeviceWorkspace = useProjectWorkspaceStore((s) => s.getOrCreateDeviceWorkspace);
  const bindTopicWorkspace = useProjectWorkspaceStore((s) => s.bindTopicWorkspace);
  const setDraftWorkspaceIntent = useProjectWorkspaceStore((s) => s.setDraftWorkspaceIntent);
  const updateDeviceCwd = useDeviceStore((s) => s.updateDeviceCwd);

  const deviceId = effective.targetDeviceId ?? effective.recommendation.deviceId;
  const isDeviceTarget = effective.target === 'local' || effective.target === 'device';
  const bindTarget = effective.target === 'device' ? 'device' : 'local';

  /** Picker is offered only while the topic (or draft) is still unbound on a device target. */
  const canSelect = effective.state === 'unbound' && isDeviceTarget && !!deviceId;
  /** Bound and scratch topics only expose the "new referenced topic" path. */
  const canStartReferencedTopic =
    (effective.state === 'bound' || effective.state === 'scratch') &&
    isDeviceTarget &&
    !!deviceId &&
    !!effective.topicId;

  const rememberRecent = useCallback(
    (selection: WorkspaceSelection) => {
      if (!deviceId) return;
      // Recent list only — never the device-wide default.
      void Promise.resolve(
        updateDeviceCwd(
          deviceId,
          { path: selection.path, repoType: selection.repoType },
          { setDefault: false },
        ),
      ).catch(() => undefined);
    },
    [deviceId, updateDeviceCwd],
  );

  const select = useCallback(
    async (selection: WorkspaceSelection): Promise<boolean> => {
      if (!deviceId || !canSelect) return false;
      setPending(true);
      setError(undefined);
      try {
        const result = await selectWorkspaceOnce({
          effective,
          ports: {
            bindTopicWorkspace,
            getOrCreateDeviceWorkspace,
            rememberRecent,
            setDraftWorkspaceIntent,
          },
          selection,
        });
        if (!result.ok) {
          if (result.code) setError({ code: result.code, message: result.message });
          return false;
        }
        return true;
      } finally {
        setPending(false);
      }
    },
    [
      bindTopicWorkspace,
      canSelect,
      deviceId,
      effective,
      getOrCreateDeviceWorkspace,
      rememberRecent,
      setDraftWorkspaceIntent,
    ],
  );

  const startReferencedTopic = useCallback(
    async (selection: WorkspaceSelection): Promise<boolean> => {
      if (!deviceId || !effective.topicId) return false;
      setPending(true);
      setError(undefined);
      try {
        const created = await getOrCreateDeviceWorkspace({
          deviceId,
          repoType: selection.repoType ?? null,
          rootPath: selection.path,
        });
        if (!created.ok) {
          setError({ code: created.code, message: created.message });
          return false;
        }

        setDraftWorkspaceIntent(effective.draftKey, {
          referenceTopicId: effective.topicId,
          target: bindTarget,
          targetDeviceId: deviceId,
          workspaceId: created.value.id,
        });
        rememberRecent({
          path: created.value.rootPath,
          repoType: created.value.repoType ?? selection.repoType,
        });
        await useChatStore.getState().switchTopic(null, { skipRefreshMessage: true });
        return true;
      } finally {
        setPending(false);
      }
    },
    [
      bindTarget,
      deviceId,
      effective.draftKey,
      effective.topicId,
      getOrCreateDeviceWorkspace,
      rememberRecent,
      setDraftWorkspaceIntent,
    ],
  );

  const clearError = useCallback(() => setError(undefined), []);

  return useMemo(
    () => ({
      canSelect,
      canStartReferencedTopic,
      clearError,
      deviceId,
      error,
      pending,
      select,
      startReferencedTopic,
    }),
    [
      canSelect,
      canStartReferencedTopic,
      clearError,
      deviceId,
      error,
      pending,
      select,
      startReferencedTopic,
    ],
  );
};

export type BindWorkspaceOnce = ReturnType<typeof useBindWorkspaceOnce>;
