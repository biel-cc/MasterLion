import type { LobeAgentAgencyConfig } from '@lobechat/types/src/agent/agencyConfig';
import type { ExecutionEnvRef } from '@lobechat/types/src/executionContext';
import type { ProjectWorkspaceEnvRecord } from '@lobechat/types/src/projectWorkspace';

import { StoredExecutionEnvService } from './storedExecutionEnv';

export interface DesktopExecutionEnvDependencies {
  decrypt: (encryptedValue: string) => Promise<string>;
  loadAgentAgencyConfig: (agentId: string) => Promise<LobeAgentAgencyConfig | null>;
  /** `undefined` means missing topic; `null` means an existing unbound topic. */
  loadTopicWorkspaceId: (topicId: string) => Promise<null | string | undefined>;
  loadUserEnv: () => Promise<ProjectWorkspaceEnvRecord | undefined>;
  /** `null` means the user-scoped workspace does not exist. */
  loadWorkspaceEnv: (workspaceId: string) => Promise<null | ProjectWorkspaceEnvRecord | undefined>;
  userId: string;
}

/** Resolve plaintext only at the authenticated server -> desktop main-process boundary. */
export const resolveDesktopExecutionEnv = async (
  input: ExecutionEnvRef,
  dependencies: DesktopExecutionEnvDependencies,
): Promise<Record<string, string>> => {
  const agencyConfig = await dependencies.loadAgentAgencyConfig(input.agentId);
  if (agencyConfig === null) throw new Error('Agent not found');

  let workspaceId = input.workspaceId;
  if (input.topicId) {
    const boundWorkspaceId = await dependencies.loadTopicWorkspaceId(input.topicId);
    if (boundWorkspaceId === undefined) throw new Error('Topic not found');
    if (workspaceId && workspaceId !== boundWorkspaceId) {
      throw new Error('Workspace reference does not match the topic binding');
    }
    workspaceId = boundWorkspaceId ?? undefined;
  }

  const workspaceEnv = workspaceId ? await dependencies.loadWorkspaceEnv(workspaceId) : undefined;
  if (workspaceId && workspaceEnv === null) throw new Error('Workspace not found');

  const service = new StoredExecutionEnvService({
    decrypt: dependencies.decrypt,
    loadUserEnv: async () => dependencies.loadUserEnv(),
    loadWorkspaceEnv: async (id) => (id === workspaceId ? (workspaceEnv ?? undefined) : undefined),
  });
  const env = await service.resolveAgencyConfig({
    agencyConfig,
    agentId: input.agentId,
    operationId: `desktop-env:${input.agentId}:${input.topicId ?? workspaceId ?? 'draft'}`,
    topicId: input.topicId,
    userId: dependencies.userId,
    workspaceId,
  });

  return env.values;
};
