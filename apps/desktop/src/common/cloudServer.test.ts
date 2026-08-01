import { describe, expect, it } from 'vitest';

import { resolveDesktopCloudServer, resolveDesktopMarketBaseUrl } from './cloudServer';

describe('desktop cloud server config', () => {
  it('normalizes the configured production origin', () => {
    expect(resolveDesktopCloudServer(' https://masterino.bielcrystal.com/ ')).toBe(
      'https://masterino.bielcrystal.com',
    );
  });

  it('rejects a missing cloud server', () => {
    expect(() => resolveDesktopCloudServer(undefined)).toThrow(
      'desktop-config.json must define a non-empty cloudServer',
    );
  });

  it('rejects a cloud server containing a path', () => {
    expect(() => resolveDesktopCloudServer('https://masterino.bielcrystal.com/api')).toThrow(
      'cloudServer must be an origin',
    );
  });

  it('derives the Market URL from the configured Cloud server', () => {
    expect(resolveDesktopMarketBaseUrl(undefined, 'https://masterino.bielcrystal.com')).toBe(
      'https://masterino.bielcrystal.com/market',
    );
  });

  it('preserves an explicit Market URL', () => {
    expect(
      resolveDesktopMarketBaseUrl(
        ' https://market-test.example.com/base/ ',
        'https://masterino.bielcrystal.com',
      ),
    ).toBe('https://market-test.example.com/base');
  });
});
