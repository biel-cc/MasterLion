import type { DeviceExecutionTarget } from '@lobechat/types/src/agent/agencyConfig';
import type { TopicExecutionIntent, WorkspaceRef } from '@lobechat/types/src/projectWorkspace';
import type { ChatTopicMetadata } from '@lobechat/types/src/topic';
import { TRPCError } from '@trpc/server';

import type { ProjectWorkspaceModel } from '@/database/models/projectWorkspace';
import { toWorkspaceRef } from '@/database/models/projectWorkspace';

const assertCompatibleTarget = (target: DeviceExecutionTarget, workspace: WorkspaceRef) => {
  const compatible =
    workspace.kind === 'sandbox' ? target === 'sandbox' : target === 'device' || target === 'local';
  if (!compatible) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Execution target ${target} is incompatible with ${workspace.kind} workspace`,
    });
  }
};

/** Shared semantic validation for every mutation that accepts renderer intent. */
export const assertValidTopicExecutionIntent = (intent: TopicExecutionIntent) => {
  if (intent.platform === 'web' && intent.target === 'local') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'A web client cannot create a local execution target',
    });
  }
  if ((intent.target === 'none' || intent.target === 'sandbox') && intent.targetDeviceId) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Execution target ${intent.target} cannot bind a device`,
    });
  }
};

/**
 * Validate a one-shot client intent and build the server-authored metadata
 * written in the topic INSERT. The resulting executionSnapshot is therefore
 * never temporarily absent from a newly-created topic.
 */
export const resolveTopicCreationExecutionMetadata = async (params: {
  intent?: TopicExecutionIntent;
  metadata?: ChatTopicMetadata;
  now?: Date;
  organizationWorkspaceId?: string;
  workspaceModel: ProjectWorkspaceModel;
}): Promise<ChatTopicMetadata | undefined> => {
  const { intent, metadata, organizationWorkspaceId, workspaceModel } = params;
  if (!intent) return metadata;
  assertValidTopicExecutionIntent(intent);

  const now = params.now ?? new Date();
  let workspace = intent.workspaceId
    ? await workspaceModel.findById(intent.workspaceId)
    : undefined;
  if (intent.workspaceId && !workspace) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });
  }

  // Explicit sandbox is a real, bind-once workspace rather than an unbound
  // topic that happens to run in /workspace.
  workspace ??=
    intent.target === 'sandbox'
      ? await workspaceModel.getOrCreate({
          kind: 'sandbox',
          rootPath: '/workspace',
          workspaceId: organizationWorkspaceId,
        })
      : undefined;

  const workspaceRef = workspace ? toWorkspaceRef(workspace) : undefined;
  if (workspaceRef) {
    assertCompatibleTarget(intent.target, workspaceRef);
    if (
      intent.targetDeviceId &&
      workspaceRef.deviceId &&
      intent.targetDeviceId !== workspaceRef.deviceId
    ) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Selected device does not own the selected workspace',
      });
    }
  }

  const capturedAt = now.toISOString();
  const executionSnapshot = {
    boundDeviceId: workspaceRef?.deviceId ?? intent.targetDeviceId,
    target: intent.target,
    targetCapturedAt: capturedAt,
    version: 1 as const,
    ...(workspaceRef?.id
      ? {
          workspaceBoundAt: capturedAt,
          workspaceId: workspaceRef.id,
          workspaceKind: workspaceRef.kind,
        }
      : {}),
  };
  const next: ChatTopicMetadata = { ...metadata, executionSnapshot };

  if (workspaceRef?.id) {
    next.workspaceId = workspaceRef.id;
    next.workspaceKind = workspaceRef.kind;
    if (workspaceRef.kind === 'sandbox') {
      delete next.boundDeviceId;
      delete next.workingDirectory;
    } else {
      next.boundDeviceId = workspaceRef.deviceId;
      next.workingDirectory = workspaceRef.rootPath;
    }
  } else {
    // A target-only snapshot is intentionally unbound. Never preserve legacy
    // client authority fields alongside it.
    delete next.workingDirectory;
    delete next.boundDeviceId;
  }

  return next;
};
