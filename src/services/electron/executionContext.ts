import type {
  CloseExecutionContextResult,
  ExecutionContextRef,
  PreparedExecutionContext,
  PrepareExecutionContextParams,
} from '@lobechat/electron-client-ipc';
import {
  type LocalExecutionContextSnapshot,
  LocalExecutionContextSnapshotSchema,
} from '@lobechat/types';

import { ensureElectronIpc } from '@/utils/electron/ipc';

const freezeSnapshot = (snapshot: PreparedExecutionContext): LocalExecutionContextSnapshot => {
  Object.freeze(snapshot.environment.overriddenKeys);
  Object.freeze(snapshot.environment.removedKeys);
  Object.freeze(snapshot.environment);
  Object.freeze(snapshot.ref);
  if (snapshot.runtimePlan.packageManagerCapability) {
    Object.freeze(snapshot.runtimePlan.packageManagerCapability);
  }
  Object.freeze(snapshot.runtimePlan.runtimeCapability);
  Object.freeze(snapshot.runtimePlan);
  Object.freeze(snapshot.workspace.writableRoots);
  Object.freeze(snapshot.workspace);
  return Object.freeze(snapshot);
};

class ExecutionContextService {
  async prepare(params: PrepareExecutionContextParams): Promise<LocalExecutionContextSnapshot> {
    const snapshot = await ensureElectronIpc().executionContext.prepare(params);
    return freezeSnapshot(LocalExecutionContextSnapshotSchema.parse(snapshot));
  }

  async inspect(ref: ExecutionContextRef): Promise<LocalExecutionContextSnapshot> {
    const snapshot = await ensureElectronIpc().executionContext.inspect({
      ref,
    });
    return freezeSnapshot(LocalExecutionContextSnapshotSchema.parse(snapshot));
  }

  async close(ref: ExecutionContextRef): Promise<CloseExecutionContextResult> {
    return ensureElectronIpc().executionContext.close({ ref });
  }
}

export const executionContextService = new ExecutionContextService();
