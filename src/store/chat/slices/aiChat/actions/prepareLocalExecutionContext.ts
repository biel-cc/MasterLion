import type { ExecutionWorkload } from '@lobechat/electron-client-ipc';

import { executionContextService } from '@/services/electron/executionContext';
import { resolveShellEnvironmentPolicy } from '@/services/electron/executionIntent';
import { getAgentStoreState } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { getPendingTopicRepos } from '@/store/chat/pendingTopicRepos';
import { getChatStoreState } from '@/store/chat/store';
import { getElectronStoreState } from '@/store/electron';

import { topicSelectors } from '../../../selectors';

interface PrepareLocalExecutionContextOptions {
  agentId: string;
  operationId: string;
  topicId?: string | null;
  workload: ExecutionWorkload;
}

/**
 * Resolve the renderer-side intent exactly once for every local operation.
 * Electron main remains authoritative for realpath, environment values,
 * preflight, and the final immutable snapshot.
 */
export const prepareLocalExecutionContext = async ({
  agentId,
  operationId,
  topicId,
  workload,
}: PrepareLocalExecutionContextOptions) => {
  const agentState = getAgentStoreState();
  const existingTopic = topicId
    ? topicSelectors.getTopicById(topicId)(getChatStoreState())
    : undefined;
  const currentDeviceId = getElectronStoreState().gatewayDeviceInfo?.deviceId;
  const agentWorkingDirectory = agentByIdSelectors.getAgentSelectedWorkingDirectoryById(
    agentId,
    currentDeviceId,
  )(agentState);
  const pendingWorkingDirectory = !topicId ? getPendingTopicRepos(agentId)[0] : undefined;
  const requestedWorkingDirectory =
    existingTopic?.metadata?.workingDirectory ??
    pendingWorkingDirectory ??
    agentWorkingDirectory ??
    null;

  return executionContextService.prepare({
    agentId,
    environmentPolicy: resolveShellEnvironmentPolicy(
      chatConfigByIdSelectors.getRuntimeEnvConfigById(agentId)(agentState)?.shellEnvironmentProfile,
    ),
    operationId,
    requestedWorkingDirectory,
    topicId,
    workload,
  });
};
