import { afterEach, describe, expect, it } from 'vitest';

import { getAgentExecutionConfig } from './agent';

const KEYS = [
  'MEMORY_USER_MEMORY_EMBEDDING_CONTEXT_LIMIT',
  'TASK_EXECUTION_MAX_DURATION_SECONDS',
  'TASK_EXECUTION_MAX_STEPS',
  'TASK_EXECUTION_MAX_TOTAL_TOKENS',
] as const;

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

describe('getAgentExecutionConfig', () => {
  it('uses safe defaults', () => {
    const env = getAgentExecutionConfig();

    expect(env.TASK_EXECUTION_MAX_STEPS).toBe(200);
    expect(env.TASK_EXECUTION_MAX_DURATION_SECONDS).toBe(3600);
    expect(env.TASK_EXECUTION_MAX_TOTAL_TOKENS).toBe(5_000_000);
    expect(env.MEMORY_USER_MEMORY_EMBEDDING_CONTEXT_LIMIT).toBe(7500);
  });

  it('accepts a large embedding context limit', () => {
    process.env.MEMORY_USER_MEMORY_EMBEDDING_CONTEXT_LIMIT = '10000000';

    expect(getAgentExecutionConfig().MEMORY_USER_MEMORY_EMBEDDING_CONTEXT_LIMIT).toBe(10_000_000);
  });

  it.each([
    ['TASK_EXECUTION_MAX_STEPS', '0'],
    ['TASK_EXECUTION_MAX_DURATION_SECONDS', '59'],
    ['TASK_EXECUTION_MAX_TOTAL_TOKENS', '1.5'],
    ['MEMORY_USER_MEMORY_EMBEDDING_CONTEXT_LIMIT', '10000001'],
  ] as const)('rejects invalid %s=%s', (key, value) => {
    process.env[key] = value;
    expect(() => getAgentExecutionConfig()).toThrow();
  });
});
