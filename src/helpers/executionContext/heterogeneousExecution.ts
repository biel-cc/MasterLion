import type { ExecutionContext, ExecutionContextError } from '@lobechat/types/src/executionContext';
import type { NormalizedWorkspaceIdentity } from '@lobechat/types/src/projectWorkspace';

import { assertExecutionContextReady } from './resolveExecutionContext';
import { normalizeWorkspaceIdentity } from './workspaceIdentity';

interface ReadyHeterogeneousExecution {
  cwd: string;
  workspaceIdentity: NormalizedWorkspaceIdentity;
}

export type HeterogeneousExecutionRoute<Blocked, Ready> =
  | { status: 'blocked'; value: Blocked }
  | { status: 'ready'; value: Ready };

/**
 * Single production dispatcher for the heterogeneous workspace hard gate.
 * Both server `execAgent` and focused Electron acceptance call through here,
 * so a missing workspace cannot be accidentally bypassed by a test-only
 * `if` statement or by a second send entry point.
 */
export const routeHeterogeneousExecution = async <Blocked, Ready>(params: {
  context: ExecutionContext;
  onBlocked: (error: ExecutionContextError) => Promise<Blocked> | Blocked;
  onReady: (execution: ReadyHeterogeneousExecution) => Promise<Ready> | Ready;
}): Promise<HeterogeneousExecutionRoute<Blocked, Ready>> => {
  const readiness = assertExecutionContextReady(params.context, { requireWorkspace: true });
  if (readiness || !params.context.cwd || !params.context.workspace) {
    const error =
      readiness ??
      ({
        code: 'WORKSPACE_REQUIRED',
        message: 'A workspace is required for this operation.',
      } satisfies ExecutionContextError);
    return { status: 'blocked', value: await params.onBlocked(error) };
  }

  return {
    status: 'ready',
    value: await params.onReady({
      cwd: params.context.cwd,
      workspaceIdentity: normalizeWorkspaceIdentity(params.context.workspace),
    }),
  };
};
