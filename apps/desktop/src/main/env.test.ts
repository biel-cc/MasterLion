import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalOfficialCloudServer = process.env.OFFICIAL_CLOUD_SERVER;
const originalDisableAppUpdate = process.env.DISABLE_APP_UPDATE;

beforeEach(() => {
  vi.resetModules();
  delete process.env.DISABLE_APP_UPDATE;
  delete process.env.OFFICIAL_CLOUD_SERVER;
});

afterEach(() => {
  if (originalDisableAppUpdate === undefined) {
    delete process.env.DISABLE_APP_UPDATE;
  } else {
    process.env.DISABLE_APP_UPDATE = originalDisableAppUpdate;
  }

  if (originalOfficialCloudServer === undefined) {
    delete process.env.OFFICIAL_CLOUD_SERVER;
  } else {
    process.env.OFFICIAL_CLOUD_SERVER = originalOfficialCloudServer;
  }
});

describe('desktop environment', () => {
  it('defaults the cloud service to the Masterino production origin', async () => {
    const { getDesktopEnv } = await import('./env');

    expect(getDesktopEnv().OFFICIAL_CLOUD_SERVER).toBe('https://masterion.bielcrystal.com');
  });

  it('accepts an explicit runtime cloud service override', async () => {
    process.env.OFFICIAL_CLOUD_SERVER = 'https://desktop-build.example.com';
    const { getDesktopEnv } = await import('./env');

    expect(getDesktopEnv().OFFICIAL_CLOUD_SERVER).toBe('https://desktop-build.example.com');
  });

  it('disables app updates when requested by the test build', async () => {
    process.env.DISABLE_APP_UPDATE = '1';
    const { getDesktopEnv } = await import('./env');

    expect(getDesktopEnv().DISABLE_APP_UPDATE).toBe(true);
  });
});
