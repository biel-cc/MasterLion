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
 * making every desktop entry point fail closed. Every native client run passes
 * through the server coordinator because LocalSystem may be injected from its
 * device-capable plan even when absent from the static plugin list. This is
 * also the only production path that can lazily create/bind scratch after the
 * first cwd-dependent tool succeeds while leaving explicit absolute-path reads
 * unbound. Gateway preserves the frozen local target and dispatches tools back
 * to its bound device; this never means "fall back to sandbox". Desktop
 * heterogeneous CLIs keep their in-process path unless the server reports
 * managed user/workspace env that requires server-side resolution.
 */
export const routeDesktopWorkspaceRuntime = async (
  runtimeType: AgentRuntimeType,
  ref: { topicId?: string; workspaceId?: string },
  authority: ManagedEnvAuthority = projectWorkspaceService,
  isDesktop = defaultIsDesktop,
): Promise<AgentRuntimeType> => {
  if (!isDesktop || runtimeType === 'gateway') return runtimeType;
  // LocalSystem can be injected dynamically from a device-capable execution
  // plan even when it is absent from agentConfig.plugins. Renderer-local
  // execution therefore cannot reliably prove a run is plain chat, and lacks
  // the server-authored consent/grants/full frozen context when it is not.
  // Route every native client run through the coordinator; the frozen target
  // remains local and never falls back to sandbox.
  if (runtimeType === 'client') return 'gateway';

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
