import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const mocks = vi.hoisted(() => ({
  cleanupExpired: vi.fn().mockResolvedValue(0),
  create: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('next/server', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;

  return {
    ...actual,
    after: vi.fn((callback: () => unknown) => void callback()),
  };
});

vi.mock('@/database/models/oauthHandoff', () => ({
  OAuthHandoffModel: class {
    cleanupExpired = mocks.cleanupExpired;
    create = mocks.create;
  },
}));
vi.mock('@/database/server', () => ({ serverDB: {} }));
vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'https://masterino.bielcrystal.com' },
}));

describe('GET /oidc/callback/desktop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores the authorization code under the state handoff id', async () => {
    const response = await GET(
      new NextRequest(
        'https://masterino.bielcrystal.com/oidc/callback/desktop?code=auth-code&state=handoff-id',
      ),
    );

    expect(mocks.create).toHaveBeenCalledWith({
      client: 'desktop',
      id: 'handoff-id',
      payload: { code: 'auth-code', state: 'handoff-id' },
    });
    expect(response.headers.get('location')).toBe(
      'https://masterino.bielcrystal.com/oauth/callback/success',
    );
    expect(mocks.cleanupExpired).toHaveBeenCalledOnce();
  });

  it('redirects invalid callbacks without creating a handoff', async () => {
    const response = await GET(
      new NextRequest('https://masterino.bielcrystal.com/oidc/callback/desktop?state=missing-code'),
    );

    expect(mocks.create).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBe(
      'https://masterino.bielcrystal.com/oauth/callback/error?reason=invalid_request',
    );
  });
});
