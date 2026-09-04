import { describe, expect, it } from 'vitest';

import { getAgentEnvKeyError, sanitizeAgentEnv } from './agentEnvPolicy';

describe('agentEnvPolicy', () => {
  it.each([
    ['NODE_OPTIONS', 'sensitive'],
    ['DYLD_INSERT_LIBRARIES', 'reserved'],
    ['MASTERINO_OPERATION_ID', 'reserved'],
    ['PATH', 'reserved'],
  ] as const)('uses the shared execution policy for %s', (key, expected) => {
    expect(getAgentEnvKeyError(key)).toBe(expected);
  });

  it('keeps agent-specific credential names sensitive while allowing ordinary keys', () => {
    expect(getAgentEnvKeyError('DATABASE_URL')).toBe('sensitive');
    expect(getAgentEnvKeyError('SAFE_SETTING')).toBeUndefined();
  });

  it('removes every shared or agent-specific restricted key before persistence', () => {
    expect(
      sanitizeAgentEnv({
        DATABASE_URL: 'postgres://secret',
        DYLD_INSERT_LIBRARIES: '/tmp/inject.dylib',
        NODE_OPTIONS: '--require /tmp/inject.js',
        SAFE_SETTING: 'safe',
      }),
    ).toEqual({ SAFE_SETTING: 'safe' });
  });
});
