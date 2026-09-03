import type { AcceptanceId } from '../../../test/workspace-runtime/contracts';
import { acceptedRefWorkspaceRuntimeAdapter } from '../../../test/workspace-runtime/acceptedRefAdapter';

/** Runs the same production-bound acceptance adapter behind the Electron main-process IPC seam. */
export const observeWorkspaceRuntime = async (id: AcceptanceId) => {
  const observe = acceptedRefWorkspaceRuntimeAdapter[id] as () => Promise<unknown>;
  if (!observe) throw new Error(`Unknown Workspace Runtime acceptance id: ${id}`);
  return observe();
};
