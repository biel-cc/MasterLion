import type { ExecutionEnv } from '@lobechat/types/src/executionContext';

export const REDACTED_EXECUTION_ENV_VALUE = '[redacted]';

const resolvedValues = (env: ExecutionEnv): string[] =>
  Object.values(env.values)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .sort((left, right) => right.length - left.length);

export const redactExecutionEnvText = (text: string, env: ExecutionEnv): string => {
  let redacted = text;
  for (const value of resolvedValues(env)) {
    redacted = redacted.replaceAll(value, REDACTED_EXECUTION_ENV_VALUE);
  }
  return redacted;
};

/** Recursively prepare diagnostic data without copying resolved secret values. */
export const redactExecutionEnvData = (value: unknown, env: ExecutionEnv): unknown => {
  if (typeof value === 'string') return redactExecutionEnvText(value, env);
  if (Array.isArray(value)) return value.map((item) => redactExecutionEnvData(item, env));
  if (value instanceof Error) {
    return {
      message: redactExecutionEnvText(value.message, env),
      name: value.name,
    };
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactExecutionEnvData(item, env)]),
    );
  }
  return value;
};
