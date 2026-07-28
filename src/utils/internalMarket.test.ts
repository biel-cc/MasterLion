import { afterEach, describe, expect, it, vi } from 'vitest';

import { getPublicInternalMarketBaseUrl } from './internalMarket';

const originalLobeEnv = window.lobeEnv;

afterEach(() => {
  window.lobeEnv = originalLobeEnv;
  vi.unstubAllEnvs();
});

describe('getPublicInternalMarketBaseUrl', () => {
  it('uses the Market URL exposed from desktop-config.json', () => {
    vi.stubEnv('NEXT_PUBLIC_MARKET_BASE_URL', '');
    window.lobeEnv = { marketBaseUrl: 'https://masterion.bielcrystal.com/market' };

    expect(getPublicInternalMarketBaseUrl()).toBe('https://masterion.bielcrystal.com/market');
  });

  it('keeps the web environment fallback', () => {
    vi.stubEnv('NEXT_PUBLIC_MARKET_BASE_URL', 'https://web.example.com/market/');
    window.lobeEnv = undefined;

    expect(getPublicInternalMarketBaseUrl()).toBe('https://web.example.com/market');
  });
});
