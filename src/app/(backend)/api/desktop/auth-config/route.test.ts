import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const mocks = vi.hoisted(() => ({
  appEnv: { APP_URL: 'https://masterion.bielcrystal.com' as string | undefined },
  authEnv: { ENABLE_OIDC: true },
}));

vi.mock('@/envs/app', () => ({ appEnv: mocks.appEnv }));
vi.mock('@/envs/auth', () => ({ authEnv: mocks.authEnv }));

describe('GET /api/desktop/auth-config', () => {
  beforeEach(() => {
    mocks.appEnv.APP_URL = 'https://masterion.bielcrystal.com';
    mocks.authEnv.ENABLE_OIDC = true;
  });

  it('returns the canonical APP_URL and desktop redirect URI without secrets', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({
      appUrl: 'https://masterion.bielcrystal.com/',
      redirectUri: 'https://masterion.bielcrystal.com/oidc/callback/desktop',
    });
  });

  it('fails clearly when OIDC is disabled', async () => {
    mocks.authEnv.ENABLE_OIDC = false;

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'OIDC is not enabled on this server' });
  });

  it('fails clearly when APP_URL is missing or invalid', async () => {
    mocks.appEnv.APP_URL = undefined;
    const missingResponse = await GET();

    expect(missingResponse.status).toBe(503);
    expect(await missingResponse.json()).toEqual({
      error: 'APP_URL is not configured on this server',
    });

    mocks.appEnv.APP_URL = 'not-a-url';
    const invalidResponse = await GET();

    expect(invalidResponse.status).toBe(503);
    expect(await invalidResponse.json()).toEqual({ error: 'APP_URL is invalid on this server' });
  });
});
