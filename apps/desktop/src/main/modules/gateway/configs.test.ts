import { describe, expect, it } from 'vitest';

import { DEFAULT_GATEWAY_URL, resolveGatewayUrl } from './configs';

describe('gateway configs', () => {
  it('uses the production device gateway by default', () => {
    expect(resolveGatewayUrl({})).toBe(DEFAULT_GATEWAY_URL);
    expect(DEFAULT_GATEWAY_URL).toBe('https://masterino.bielcrystal.com/device-gateway');
  });

  it.each(['https://aihub.bielcrystal.com', 'https://masterino.bielcrystal.com'])(
    'migrates legacy default %s to the production device gateway',
    (storedUrl) => {
      expect(resolveGatewayUrl({ storedUrl })).toBe(DEFAULT_GATEWAY_URL);
    },
  );

  it('preserves a user configured gateway URL', () => {
    expect(resolveGatewayUrl({ storedUrl: 'http://localhost:8787' })).toBe('http://localhost:8787');
  });

  it('prefers the build or runtime environment override', () => {
    expect(
      resolveGatewayUrl({
        envUrl: 'https://gateway.example.com',
        storedUrl: 'http://localhost:8787',
      }),
    ).toBe('https://gateway.example.com');
  });
});
