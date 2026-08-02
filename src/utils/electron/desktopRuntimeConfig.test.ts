import { afterEach, describe, expect, it } from 'vitest';

import {
  getDesktopCloudServer,
  getDesktopCloudServerAliases,
  getDesktopMarketBaseUrl,
} from './desktopRuntimeConfig';

const originalLobeEnv = window.lobeEnv;

afterEach(() => {
  window.lobeEnv = originalLobeEnv;
});

describe('desktop renderer runtime config', () => {
  it('reads Cloud and Market URLs exposed by the preload', () => {
    window.lobeEnv = {
      cloudServer: 'https://masterino.bielcrystal.com',
      cloudServerAliases: ['https://mlai-test.bielcrystal.com'],
      marketBaseUrl: 'https://masterino.bielcrystal.com/market',
    };

    expect(getDesktopCloudServer()).toBe('https://masterino.bielcrystal.com');
    expect(getDesktopCloudServerAliases()).toEqual(['https://mlai-test.bielcrystal.com']);
    expect(getDesktopMarketBaseUrl()).toBe('https://masterino.bielcrystal.com/market');
  });

  it('derives Market from Cloud when the optional field is omitted', () => {
    window.lobeEnv = { cloudServer: 'https://mlai-test.bielcrystal.com/' };

    expect(getDesktopMarketBaseUrl()).toBe('https://mlai-test.bielcrystal.com/market');
  });

  it('reports a missing sidecar value clearly', () => {
    window.lobeEnv = {};

    expect(() => getDesktopCloudServer()).toThrow(
      'cloudServer is missing from desktop-config.json',
    );
  });
});
