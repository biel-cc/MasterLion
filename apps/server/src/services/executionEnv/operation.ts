import type {
  ExecutionEnv,
  ExecutionEnvAdapter,
  ExecutionEnvRef,
} from '@lobechat/types/src/executionContext';

import { ExecutionEnvError } from './errors';

export interface ResolveOperationExecutionEnvInput {
  adapter: ExecutionEnvAdapter;
  envRef?: ExecutionEnvRef;
  operationId: string;
  userId: string;
}

/** Gateway/server boundary. Execution must stop when a renderer env reference is absent. */
export const resolveOperationExecutionEnv = async ({
  adapter,
  envRef,
  operationId,
  userId,
}: ResolveOperationExecutionEnvInput): Promise<ExecutionEnv> => {
  if (!envRef?.agentId?.trim()) {
    throw new ExecutionEnvError(
      'ENV_REF_REQUIRED',
      'An execution environment reference is required for this operation.',
    );
  }

  return adapter.resolve({
    agentId: envRef.agentId,
    operationId,
    topicId: envRef.topicId,
    userId,
    workspaceId: envRef.workspaceId,
  });
};
