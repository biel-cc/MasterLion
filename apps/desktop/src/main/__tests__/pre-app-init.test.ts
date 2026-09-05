import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { app, isDev } = vi.hoisted(() => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => 'C:\\Users\\test\\AppData\\Roaming'),
    setName: vi.fn(),
    setPath: vi.fn(),
  },
  isDev: vi.fn(() => false),
}));

vi.mock('electron', () => ({ app }));
vi.mock('electron-is', () => ({ dev: isDev }));

describe('pre-app-init user data isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.DESKTOP_BUILD_FLAVOR;
    delete process.env.MASTERINO_DESKTOP_PROFILE;
    app.isPackaged = false;
    isDev.mockReturnValue(false);
  });

  afterEach(() => {
    delete process.env.DESKTOP_BUILD_FLAVOR;
    delete process.env.MASTERINO_DESKTOP_PROFILE;
    app.isPackaged = false;
  });

  it('keeps production on the default user data directory', async () => {
    await import('../pre-app-init');

    expect(app.setName).toHaveBeenCalledWith('Masterino');
    expect(app.setPath).not.toHaveBeenCalled();
  });

  it('isolates development data from production', async () => {
    isDev.mockReturnValue(true);

    await import('../pre-app-init');

    expect(app.setPath).toHaveBeenCalledWith(
      'userData',
      path.join('C:\\Users\\test\\AppData\\Roaming', 'masterino-desktop-dev'),
    );
  });

  it('isolates packaged test builds from production', async () => {
    process.env.DESKTOP_BUILD_FLAVOR = 'test';

    await import('../pre-app-init');

    expect(app.setPath).toHaveBeenCalledWith(
      'userData',
      path.join('C:\\Users\\test\\AppData\\Roaming', 'masterino-desktop-test'),
    );
  });
  it.each(['local-123456abcdef', 'test-server'])(
    'uses a separate source-development profile: %s',
    async (profile) => {
      isDev.mockReturnValue(true);
      process.env.MASTERINO_DESKTOP_PROFILE = profile;
      await import('../pre-app-init');
      expect(app.setPath).toHaveBeenCalledWith(
        'userData',
        path.join(app.getPath(), `masterino-desktop-${profile}`),
      );
    },
  );

  it('never applies the development profile to a packaged test app', async () => {
    app.isPackaged = true;
    process.env.DESKTOP_BUILD_FLAVOR = 'test';
    process.env.MASTERINO_DESKTOP_PROFILE = 'local-123456abcdef';
    await import('../pre-app-init');
    expect(app.setPath).toHaveBeenCalledWith(
      'userData',
      path.join(app.getPath(), 'masterino-desktop-test'),
    );
  });

  it('rejects a development profile containing a path', async () => {
    isDev.mockReturnValue(true);
    process.env.MASTERINO_DESKTOP_PROFILE = '../production';
    await expect(import('../pre-app-init')).rejects.toThrow('Invalid isolated');
  });
});
