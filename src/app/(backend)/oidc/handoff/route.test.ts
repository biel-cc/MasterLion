import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const mocks = vi.hoisted(() => ({
  fetchAndConsume: vi.fn(),
}));

vi.mock('@/database/models/oauthHandoff', () => ({
  OAuthHandoffModel: class {
    fetchAndConsume = mocks.fetchAndConsume;
  },
}));
vi.mock('@/database/server', () => ({ serverDB: {} }));

describe('GET /oidc/handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a handoff once and reports it missing after consumption', async () => {
    const handoff = {
      client: 'desktop',
      id: 'handoff-id',
      payload: { code: 'auth-code', state: 'handoff-id' },
    };
    mocks.fetchAndConsume.mockResolvedValueOnce(handoff).mockResolvedValueOnce(null);
    const requestUrl =
      'https://masterion.bielcrystal.com/oidc/handoff?id=handoff-id&client=desktop';

    const firstResponse = await GET(new NextRequest(requestUrl));
    const secondResponse = await GET(new NextRequest(requestUrl));

    expect(firstResponse.status).toBe(200);
    expect(await firstResponse.json()).toEqual({ data: handoff, success: true });
    expect(secondResponse.status).toBe(404);
    expect(await secondResponse.json()).toEqual({
      error: 'Handoff record not found or expired',
    });
    expect(mocks.fetchAndConsume).toHaveBeenNthCalledWith(1, 'handoff-id', 'desktop');
    expect(mocks.fetchAndConsume).toHaveBeenNthCalledWith(2, 'handoff-id', 'desktop');
  });

  it('rejects requests missing the id or client', async () => {
    const response = await GET(
      new NextRequest('https://masterion.bielcrystal.com/oidc/handoff?id=handoff-id'),
    );

    expect(response.status).toBe(400);
    expect(mocks.fetchAndConsume).not.toHaveBeenCalled();
  });
});
