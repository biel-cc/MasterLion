import type { BeforeSendPayload } from '@/features/Conversation/ChatInput';
import type { EffectiveWorkspace } from '@/hooks/useEffectiveWorkspace';
import type { ProjectWorkspaceErrorCode } from '@/store/projectWorkspace';

import { detectWorkspaceBindingIntent } from './workspaceBindingIntent';

export interface WorkspaceSelection {
  path: string;
  repoType?: 'git' | 'github';
}

interface WorkspaceSelectionOutcome {
  code?: ProjectWorkspaceErrorCode;
  message?: string;
  ok: boolean;
}

interface WorkspaceSelectionPorts {
  bindTopicWorkspace: (input: {
    target: 'device' | 'local';
    topicId: string;
    workspaceId: string;
  }) => Promise<WorkspaceSelectionOutcome>;
  getOrCreateDeviceWorkspace: (input: {
    deviceId: string;
    repoType: 'git' | 'github' | null;
    rootPath: string;
  }) => Promise<
    | {
        ok: true;
        value: {
          id: string;
          repoType?: 'git' | 'github' | null;
          rootPath: string;
        };
      }
    | WorkspaceSelectionOutcome
  >;
  rememberRecent: (selection: WorkspaceSelection) => void;
  setDraftWorkspaceIntent: (
    draftKey: string,
    intent: {
      target: 'device' | 'local';
      targetDeviceId: string;
      workspaceId: string;
    },
  ) => void;
}

export interface SelectWorkspaceOnceResult {
  code?: ProjectWorkspaceErrorCode;
  message?: string;
  ok: boolean;
  workspaceId?: string;
}

/**
 * Production bind-once action shared by the renderer hook and acceptance lane.
 * Its only ports are the existing workspace store writes and recent-list side
 * effect; policy and ordering cannot be restated by a test harness.
 */
export const selectWorkspaceOnce = async (params: {
  effective: EffectiveWorkspace;
  ports: WorkspaceSelectionPorts;
  selection: WorkspaceSelection;
}): Promise<SelectWorkspaceOnceResult> => {
  const { effective, ports, selection } = params;
  const deviceId = effective.targetDeviceId ?? effective.recommendation.deviceId;
  const isDeviceTarget = effective.target === 'local' || effective.target === 'device';
  const canSelect = effective.state === 'unbound' && isDeviceTarget && !!deviceId;
  if (!deviceId || !canSelect) return { ok: false };

  const created = await ports.getOrCreateDeviceWorkspace({
    deviceId,
    repoType: selection.repoType ?? null,
    rootPath: selection.path,
  });
  if (!created.ok || !('value' in created)) {
    return { code: created.code, message: created.message, ok: false };
  }

  const target = effective.target === 'device' ? 'device' : 'local';
  if (effective.isDraft || !effective.topicId) {
    ports.setDraftWorkspaceIntent(effective.draftKey, {
      target,
      targetDeviceId: deviceId,
      workspaceId: created.value.id,
    });
  } else {
    const bound = await ports.bindTopicWorkspace({
      target,
      topicId: effective.topicId,
      workspaceId: created.value.id,
    });
    if (!bound.ok) return { code: bound.code, message: bound.message, ok: false };
  }

  ports.rememberRecent({
    path: created.value.rootPath,
    repoType: created.value.repoType ?? selection.repoType,
  });
  return { ok: true, workspaceId: created.value.id };
};

export interface WorkspaceIntentConfirmation {
  confirm: (params: { bind: () => Promise<boolean>; rootPath: string }) => Promise<boolean>;
  desktop: boolean;
  effective: Pick<EffectiveWorkspace, 'state'>;
  payload: BeforeSendPayload;
  select: (selection: WorkspaceSelection) => Promise<boolean>;
}

/**
 * Production pre-send dispatcher for direct persistent-directory intent.
 * Rejected rich sources return immediately without ever receiving a bind
 * callback; an accepted confirmation must finish the bind before send resumes.
 */
export const confirmWorkspaceBindingIntent = async ({
  confirm,
  desktop,
  effective,
  payload,
  select,
}: WorkspaceIntentConfirmation): Promise<boolean> => {
  if (!desktop || effective.state !== 'unbound') return true;

  const intent = detectWorkspaceBindingIntent(payload);
  if (!intent) return true;

  return confirm({
    bind: () => select({ path: intent.rootPath }),
    rootPath: intent.rootPath,
  });
};
