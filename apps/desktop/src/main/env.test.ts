import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalOfficialCloudServer = process.env.OFFICIAL_CLOUD_SERVER;
const originalDisableAppUpdate = process.env.DISABLE_APP_UPDATE;
const originalDeviceGatewayUrl = process.env.DEVICE_GATEWAY_URL;

beforeEach(() => {
  vi.resetModules();
  delete process.env.DEVICE_GATEWAY_URL;
  delete process.env.DISABLE_APP_UPDATE;
  delete process.env.OFFICIAL_CLOUD_SERVER;
});

afterEach(() => {
  if (originalDeviceGatewayUrl === undefined) {
    delete process.env.DEVICE_GATEWAY_URL;
  } else {
    process.env.DEVICE_GATEWAY_URL = originalDeviceGatewayUrl;
  }

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

    expect(getDesktopEnv().OFFICIAL_CLOUD_SERVER).toBe('https://masterino.bielcrystal.com');
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
  it('preserves the build-time device gateway override in the runtime env', async () => {
    process.env.DEVICE_GATEWAY_URL = 'https://mlai-test.bielcrystal.com/device-gateway';
    const { getDesktopEnv } = await import('./env');

    expect(getDesktopEnv().DEVICE_GATEWAY_URL).toBe(
      'https://mlai-test.bielcrystal.com/device-gateway',
    );
  });

});
