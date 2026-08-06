// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  downloadSkill: vi.fn(),
  getSessionUser: vi.fn(),
  marketServiceConstructor: vi.fn(),
}));

vi.mock('@/libs/trusted-client', () => ({
  getSessionUser: mocks.getSessionUser,
}));

vi.mock('@/server/services/market', () => ({
  MarketService: mocks.marketServiceConstructor.mockImplementation(() => ({
    downloadSkill: mocks.downloadSkill,
  })),
}));

describe('Market skill archive download route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue({ userId: 'user-1' });
    mocks.downloadSkill.mockResolvedValue({
      buffer: Buffer.from('skill-archive'),
      filename: 'office-documents.zip',
    });
  });

  it('requires an authenticated user', async () => {
    mocks.getSessionUser.mockResolvedValue(undefined);
    const { GET } = await import('./route');

    const response = await GET(new Request('https://example.com/api/market/download'), {
      params: Promise.resolve({ identifier: 'office-documents' }),
    });

    expect(response.status).toBe(401);
    expect(mocks.marketServiceConstructor).not.toHaveBeenCalled();
  });

  it('downloads through the trusted server-side Market client', async () => {
    const { GET } = await import('./route');

    const response = await GET(
      new Request('https://example.com/api/market/download?version=1.2.3'),
      {
        params: Promise.resolve({ identifier: 'office-documents' }),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.marketServiceConstructor).toHaveBeenCalledWith({ userInfo: { userId: 'user-1' } });
    expect(mocks.downloadSkill).toHaveBeenCalledWith('office-documents', '1.2.3');
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('skill-archive');
  });
});
