import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalDesktopCloudServer = process.env.NEXT_PUBLIC_DESKTOP_CLOUD_SERVER;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  if (originalDesktopCloudServer === undefined) {
    delete process.env.NEXT_PUBLIC_DESKTOP_CLOUD_SERVER;
  } else {
    process.env.NEXT_PUBLIC_DESKTOP_CLOUD_SERVER = originalDesktopCloudServer;
  }
});

describe('DESKTOP_CLOUD_SERVER', () => {
  it('does not bake the production origin into the renderer bundle', async () => {
    delete process.env.NEXT_PUBLIC_DESKTOP_CLOUD_SERVER;

    const { DESKTOP_CLOUD_SERVER } = await import('./desktop');

    expect(DESKTOP_CLOUD_SERVER).toBe('');
  });

  it('uses the dedicated desktop renderer build override', async () => {
    process.env.NEXT_PUBLIC_DESKTOP_CLOUD_SERVER = ' https://desktop.example.com ';

    const { DESKTOP_CLOUD_SERVER } = await import('./desktop');

    expect(DESKTOP_CLOUD_SERVER).toBe('https://desktop.example.com');
  });
});
