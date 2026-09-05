import { describe, expect, it, vi } from 'vitest';

import { preprocessLhCommand } from '../../toolExecution/preprocessLhCommand';

vi.mock('@/libs/trpc/utils/internalJwt', () => ({
  signUserJWT: vi.fn(async () => 'operation-jwt'),
}));

vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'https://masterino.example' },
}));

vi.mock('@/utils/env', () => ({
  isDev: false,
}));

describe('preprocessLhCommand execution environment', () => {
  it('keeps plaintext out of the command and composes a protected server-only child env', async () => {
    const result = await preprocessLhCommand('lh topic list', 'user-1', {
      executionEnv: {
        values: {
          API_TOKEN: 'workspace-secret',
          LOBEHUB_JWT: 'untrusted-jwt',
          PATH: '/untrusted/bin',
        },
      },
      injectAuthInCommand: false,
      runtimeEnv: {
        LOBEHUB_JWT: 'stale-runtime-jwt',
        PATH: '/runtime/bin',
      },
    });

    expect(result.command).toBe('npx -y @lobehub/cli topic list');
    expect(result.command).not.toContain('workspace-secret');
    expect(result.command).not.toContain('operation-jwt');
    expect(result.env).toEqual({
      API_TOKEN: 'workspace-secret',
      LOBEHUB_JWT: 'operation-jwt',
      LOBEHUB_SERVER: 'https://masterino.example',
      PATH: '/runtime/bin',
    });
  });
});
