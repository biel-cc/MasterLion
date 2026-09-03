import { describe, expect, it } from 'vitest';

import { composeChildProcessEnv, isRuntimeProtectedEnvKey } from '.';

describe('composeChildProcessEnv', () => {
  it('applies resolved values over ordinary host values', () => {
    expect(
      composeChildProcessEnv({
        hostEnv: { API_MODE: 'host', PATH: '/runtime/bin' },
        resolvedEnv: { API_MODE: 'workspace', WORKSPACE_ONLY: 'enabled' },
      }),
    ).toEqual({ API_MODE: 'workspace', PATH: '/runtime/bin', WORKSPACE_ONLY: 'enabled' });
  });

  it('does not let resolved values replace runtime or security variables', () => {
    const result = composeChildProcessEnv({
      hostEnv: {
        BASH_ENV: '/runtime/bash-env',
        LOBEHUB_JWT: 'runtime-token',
        NODE_OPTIONS: '--runtime-option',
        PATH: '/runtime/bin',
      },
      resolvedEnv: {
        BASH_ENV: '/untrusted/bash-env',
        LOBEHUB_JWT: 'untrusted-token',
        NODE_OPTIONS: '--require untrusted',
        PATH: '/untrusted/bin',
      },
    });

    expect(result).toEqual({
      BASH_ENV: '/runtime/bash-env',
      LOBEHUB_JWT: 'runtime-token',
      NODE_OPTIONS: '--runtime-option',
      PATH: '/runtime/bin',
    });
  });

  it('allows trusted operation values to replace protected host values', () => {
    const result = composeChildProcessEnv({
      hostEnv: { LOBEHUB_JWT: 'stale-token', PATH: '/runtime/bin' },
      resolvedEnv: { LOBEHUB_JWT: 'untrusted-token', PATH: '/untrusted/bin' },
      runtimeEnv: { LOBEHUB_JWT: 'operation-token' },
    });

    expect(result.LOBEHUB_JWT).toBe('operation-token');
    expect(result.PATH).toBe('/runtime/bin');
  });

  it('recognizes protected keys case-insensitively and rejects invalid input keys', () => {
    expect(isRuntimeProtectedEnvKey('path')).toBe(true);
    expect(isRuntimeProtectedEnvKey('dyld_insert_libraries')).toBe(true);
    expect(isRuntimeProtectedEnvKey('masterino_operation_id')).toBe(true);
    expect(isRuntimeProtectedEnvKey('SAFE_KEY')).toBe(false);

    expect(() =>
      composeChildProcessEnv({ hostEnv: {}, resolvedEnv: { 'BAD-KEY': 'value' } }),
    ).toThrow(/Invalid environment variable name/);
  });

  it('does not mutate any source object', () => {
    const hostEnv = Object.freeze({ ORDINARY: 'host' });
    const resolvedEnv = Object.freeze({ ORDINARY: 'resolved' });
    const runtimeEnv = Object.freeze({ OPERATION: 'runtime' });

    composeChildProcessEnv({ hostEnv, resolvedEnv, runtimeEnv });

    expect(hostEnv).toEqual({ ORDINARY: 'host' });
    expect(resolvedEnv).toEqual({ ORDINARY: 'resolved' });
    expect(runtimeEnv).toEqual({ OPERATION: 'runtime' });
  });
});
