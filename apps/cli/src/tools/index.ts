import {
  type DeviceToolCallExecutionContext,
  ExecutionBoundaryError,
  type ExecutionBoundaryTrace,
  prepareToolCallExecution,
} from '@lobechat/local-file-shell';

import { log } from '../utils/logger';
import { checkPlatformCapability } from './checkPlatformCapability';
import { getAgentProfile } from './getAgentProfile';
import { cancelHeteroTask, runHeteroTask } from './heteroTask';
import { runLocalSystemTool } from './localSystemRuntime';

/**
 * CLI-only tools (platform agents). File/shell tools are handled separately by
 * {@link runLocalSystemTool}, which routes them through
 * `LocalSystemExecutionRuntime` so the result carries structured `state`.
 */
const methodMap: Record<string, (args: any) => Promise<unknown>> = {
  cancelHeteroTask,
  checkPlatformCapability,
  getAgentProfile,
  runHeteroTask,
};

export async function executeToolCall(
  apiName: string,
  argsStr: string,
  timeout?: number,
  executionContext?: DeviceToolCallExecutionContext,
  trace?: ExecutionBoundaryTrace,
): Promise<{
  content: string;
  error?: string;
  state?: unknown;
  success: boolean;
}> {
  let args: Record<string, any>;
  try {
    args = JSON.parse(argsStr);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error(`Tool call failed: ${apiName} - ${errorMsg}`);
    return { content: '', error: errorMsg, success: false };
  }

  const finalArgs =
    typeof timeout === 'number' && Number.isFinite(timeout) && !('timeout' in args)
      ? { ...args, timeout }
      : args;

  try {
    // File/shell tools route through LocalSystemExecutionRuntime so `content` is
    // the formatted prompt text and `state` carries the structured payload for
    // client renders — matching the desktop gateway path (PR #15114).
    const prepared = await prepareToolCallExecution({
      apiName,
      args: finalArgs,
      context: executionContext,
      trace,
    });
    const localResult = await runLocalSystemTool(apiName, prepared.args);
    if (localResult) {
      const { error } = localResult;
      const state =
        prepared.scopeAudit.length > 0 || prepared.warnings.length > 0
          ? {
              ...(typeof localResult.state === 'object' && localResult.state
                ? localResult.state
                : { result: localResult.state }),
              scopeAudit: prepared.scopeAudit,
              workspaceWarnings: prepared.warnings,
            }
          : localResult.state;
      return {
        content: localResult.content,
        error:
          error instanceof Error ? error.message : typeof error === 'string' ? error : undefined,
        state,
        success: localResult.success,
      };
    }

    // CLI-only tools return raw domain payloads, serialized into `content`.
    const handler = methodMap[apiName];
    if (!handler) {
      return { content: '', error: `Unknown tool API: ${apiName}`, success: false };
    }

    const result = await handler(finalArgs);
    const content = typeof result === 'string' ? result : JSON.stringify(result);

    return { content, success: true };
  } catch (error) {
    const errorMsg =
      error instanceof ExecutionBoundaryError
        ? error.code
        : error instanceof Error
          ? error.message
          : String(error);
    log.error(`Tool call failed: ${apiName} - ${errorMsg}`);
    return {
      content: errorMsg,
      error: errorMsg,
      state:
        error instanceof ExecutionBoundaryError
          ? { code: error.code, scopeAudit: error.scopeAudit }
          : undefined,
      success: false,
    };
  }
}
