import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

const integerInRange = (min: number, max: number, fallback: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);

export const getAgentExecutionConfig = () =>
  createEnv({
    runtimeEnv: {
      MEMORY_USER_MEMORY_EMBEDDING_CONTEXT_LIMIT:
        process.env.MEMORY_USER_MEMORY_EMBEDDING_CONTEXT_LIMIT,
      TASK_EXECUTION_MAX_DURATION_SECONDS: process.env.TASK_EXECUTION_MAX_DURATION_SECONDS,
      TASK_EXECUTION_MAX_STEPS: process.env.TASK_EXECUTION_MAX_STEPS,
      TASK_EXECUTION_MAX_TOTAL_TOKENS: process.env.TASK_EXECUTION_MAX_TOTAL_TOKENS,
    },
    server: {
      MEMORY_USER_MEMORY_EMBEDDING_CONTEXT_LIMIT: integerInRange(1, 10_000_000, 7500),
      TASK_EXECUTION_MAX_DURATION_SECONDS: integerInRange(60, 14_400, 3600),
      TASK_EXECUTION_MAX_STEPS: integerInRange(1, 1000, 200),
      TASK_EXECUTION_MAX_TOTAL_TOKENS: integerInRange(10_000, 50_000_000, 5_000_000),
    },
  });

export const agentExecutionEnv = getAgentExecutionConfig();

export interface ExecutionBudget {
  maxDurationMs: number;
  maxSteps: number;
  maxTotalTokens: number;
}

export const getTaskExecutionBudget = (): ExecutionBudget => ({
  maxDurationMs: agentExecutionEnv.TASK_EXECUTION_MAX_DURATION_SECONDS * 1000,
  maxSteps: agentExecutionEnv.TASK_EXECUTION_MAX_STEPS,
  maxTotalTokens: agentExecutionEnv.TASK_EXECUTION_MAX_TOTAL_TOKENS,
});
