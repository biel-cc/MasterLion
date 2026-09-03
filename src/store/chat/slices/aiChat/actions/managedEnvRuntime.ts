import { isDesktop as defaultIsDesktop } from '@lobechat/const';
import type { LobeAgentAgencyConfig } from '@lobechat/types/src/agent/agencyConfig';

import { projectWorkspaceService } from '@/services/projectWorkspace';

import type { AgentRuntimeType } from './agentDispatcher';

interface ManagedEnvAuthority {
  getManagedEnvSummary: (input: {
    topicId?: string;
    workspaceId?: string;
  }) => Promise<{ hasManagedEnv: boolean }>;
}

/** Agent env is browser-visible metadata, so its presence can be checked without exposing secrets. */
export const hasConfiguredAgentEnv = (agencyConfig?: LobeAgentAgencyConfig): boolean =>
  Object.keys(agencyConfig?.env ?? agencyConfig?.heterogeneousProvider?.env ?? {}).length > 0;

/**
 * Keep encrypted env out of the renderer while making every desktop entry
 * point fail closed. The gateway transport preserves the frozen local target
 * and dispatches the server-resolved values back to its bound device.
 */
export const routeManagedEnvRuntime = async (
  runtimeType: AgentRuntimeType,
  ref: { hasAgentEnv?: boolean; topicId?: string; workspaceId?: string },
  authority: ManagedEnvAuthority = projectWorkspaceService,
  isDesktop = defaultIsDesktop,
): Promise<AgentRuntimeType> => {
  if (!isDesktop || runtimeType === 'gateway') return runtimeType;
  // A heterogeneous in-process run already receives non-secret agent env over
  // its existing IPC session. Native client execution has no equivalent safe
  // value path, so only that runtime must be promoted to the gateway.
  if (ref.hasAgentEnv && runtimeType === 'client') return 'gateway';

  try {
    const { hasAgentEnv: _hasAgentEnv, ...authorityRef } = ref;
    const summary = await authority.getManagedEnvSummary(authorityRef);
    return summary.hasManagedEnv ? 'gateway' : runtimeType;
  } catch {
    // An unknown summary is unsafe for an in-process run because it may omit a
    // persisted secret. Gateway errors stay local-target errors and never
    // reinterpret the operation as a cloud sandbox.
    return 'gateway';
  }
};
