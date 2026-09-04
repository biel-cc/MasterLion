import { isDesktop as defaultIsDesktop } from '@lobechat/const';

import { projectWorkspaceService } from '@/services/projectWorkspace';

import type { AgentRuntimeType } from './agentDispatcher';

interface ManagedEnvAuthority {
  getManagedEnvSummary: (input: {
    topicId?: string;
    workspaceId?: string;
  }) => Promise<{ hasManagedEnv: boolean }>;
}

/**
 * Keep workspace coordination and encrypted env out of the renderer while
 * keeping the existing runtime choice for ordinary renderer execution. Desktop
 * heterogeneous CLIs are promoted only when server-owned user/workspace env
 * requires server-side resolution. Gateway selection for regular client runs
 * remains owned by `selectRuntimeType`; workspace coordination must not turn an
 * otherwise local chat into a hard dependency on an optional Gateway URL.
 */
export const routeDesktopWorkspaceRuntime = async (
  runtimeType: AgentRuntimeType,
  ref: { topicId?: string; workspaceId?: string },
  authority: ManagedEnvAuthority = projectWorkspaceService,
  isDesktop = defaultIsDesktop,
): Promise<AgentRuntimeType> => {
  if (!isDesktop || runtimeType === 'gateway') return runtimeType;
  if (runtimeType === 'client') return runtimeType;

  // Heterogeneous IPC already receives its permitted agent env. Promote it
  // only when server-owned user/workspace env must be resolved out of process.
  try {
    const summary = await authority.getManagedEnvSummary(ref);
    return summary.hasManagedEnv ? 'gateway' : runtimeType;
  } catch {
    // An unknown summary is unsafe for an in-process run because it may omit a
    // persisted secret. Gateway errors stay local-target errors and never
    // reinterpret the operation as a cloud sandbox.
    return 'gateway';
  }
};
