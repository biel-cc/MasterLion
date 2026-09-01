import type {
  CloseExecutionContextParams,
  CloseExecutionContextResult,
  InspectExecutionContextParams,
  PreparedExecutionContext,
  PrepareExecutionContextParams,
} from '@lobechat/electron-client-ipc';

import { ControllerModule, IpcMethod } from './index';

/** Thin IPC boundary over the main-process-owned execution context manager. */
export default class ExecutionContextCtr extends ControllerModule {
  static override readonly groupName = 'executionContext';

  @IpcMethod()
  prepare(params: PrepareExecutionContextParams): Promise<PreparedExecutionContext> {
    return this.app.executionContextManager.prepare(params);
  }

  @IpcMethod()
  inspect(params: InspectExecutionContextParams): Promise<PreparedExecutionContext> {
    return this.app.executionContextManager.inspect(params.ref);
  }

  @IpcMethod()
  close(params: CloseExecutionContextParams): Promise<CloseExecutionContextResult> {
    return this.app.executionContextManager.close(params.ref);
  }
}
